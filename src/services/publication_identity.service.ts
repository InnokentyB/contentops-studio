import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { DbClient } from './work_queue/types';

export type PublicationIdentityBoundary =
    | 'writer_completion'
    | 'editorial_acceptance'
    | 'release'
    | 'fact_recording';

type JsonRecord = Record<string, unknown>;

export interface PublicationIdentityCandidate {
    taskId: number;
    canonicalProfile: string;
    normalizedBodySha256: string;
    factId?: number | null;
    publicUrl?: string | null;
}

export interface PublicationIdentityCollision {
    task_id: number;
    fact_id: number | null;
    public_url: string | null;
}

function asRecord(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.entries(value as JsonRecord)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function publicationIdentityRequestSha256(value: unknown): string {
    return sha256(stableJson(value));
}

export function normalizePublicationBody(body: string): string {
    return body.normalize('NFC').replace(/\r\n?/g, '\n').trimEnd();
}

export function publicationBodySha256(body: string): string {
    return sha256(normalizePublicationBody(body));
}

export function canonicalizeMediumProfile(value: string): string {
    const input = value.trim();
    if (!input) throw new Error('[MEDIUM_CANONICAL_PROFILE_REQUIRED] Medium profile is required');
    if (/^https?:\/\//i.test(input)) {
        const url = new URL(input);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if (host !== 'medium.com') throw new Error('[MEDIUM_CANONICAL_PROFILE_INVALID] Expected a medium.com profile');
        const profilePath = url.pathname.replace(/\/+$/, '').toLowerCase();
        if (!/^\/@[^/]+$/.test(profilePath)) {
            throw new Error('[MEDIUM_CANONICAL_PROFILE_INVALID] Expected a Medium @profile URL');
        }
        return `${host}${profilePath}`;
    }
    const username = input.replace(/^@/, '').toLowerCase();
    if (!username || username.includes('/') || /\s/.test(username)) {
        throw new Error('[MEDIUM_CANONICAL_PROFILE_INVALID] Expected a Medium username');
    }
    return `medium.com/@${username}`;
}

export function mediumProfileFromChannel(channel: { config: unknown }): string {
    const config = asRecord(channel.config);
    const raw = asRecord(config.raw_account);
    const candidate = [config.profile_url, raw.profile_url, config.profileUrl, raw.profileUrl,
        config.username, raw.username, config.medium_username, raw.medium_username]
        .find(value => typeof value === 'string' && value.trim());
    if (typeof candidate !== 'string') {
        throw new Error('[MEDIUM_CANONICAL_PROFILE_REQUIRED] Channel must define profile_url or username');
    }
    return canonicalizeMediumProfile(candidate);
}

export function structuredSourceIdentity(sourceRefs: unknown): JsonRecord[] {
    const refs = Array.isArray(sourceRefs) ? sourceRefs : sourceRefs ? [sourceRefs] : [];
    if (refs.length === 0) throw new Error('[SOURCE_LINEAGE_REQUIRED] Medium publication requires source_refs');
    const normalized = refs.map((entry, index) => {
        if (typeof entry === 'string' && entry.trim()) return { type: 'reference', ref: entry.trim() };
        const record = asRecord(entry);
        const identityKeys = ['ref', 'url_ref', 'path', 'source_package_id', 'source_artifact_id',
            'theme_content_item_id'] as const;
        const hasIdentity = identityKeys.some(key => {
            const value = record[key];
            return typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0);
        });
        if (!hasIdentity) throw new Error(`[SOURCE_LINEAGE_INVALID] source_refs[${index}] has no stable identity`);
        const identity: JsonRecord = {};
        if (typeof record.type === 'string' && record.type.trim()) identity.type = record.type.trim();
        for (const key of identityKeys) {
            const value = record[key];
            if (typeof value === 'number') identity[key] = value;
            if (typeof value === 'string' && value.trim()) identity[key] = value.trim();
        }
        return identity;
    });
    return normalized.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

export function assertReportedSourceLineage(reported: unknown, persisted: JsonRecord[]): void {
    const payload = asRecord(reported);
    const explicitRefs = payload.source_identity ?? payload.source_refs;
    if (explicitRefs !== undefined) {
        const reportedIdentity = structuredSourceIdentity(explicitRefs);
        if (stableJson(reportedIdentity) !== stableJson(persisted)) throw new Error('[SOURCE_LINEAGE_DRIFT]');
    }
    const packageId = payload.source_package_id ?? payload.sourcePackageId;
    if (typeof packageId === 'string' && packageId.trim()) {
        const expected = packageId.trim();
        const matches = persisted.some(ref => ['ref', 'source_package_id', 'source_artifact_id']
            .some(key => String(ref[key] ?? '') === expected));
        if (!matches) throw new Error('[SOURCE_LINEAGE_DRIFT]');
    }
}

export function resolvePublicationIdentityCollision(
    identity: Pick<PublicationIdentityCandidate, 'taskId' | 'canonicalProfile' | 'normalizedBodySha256'>,
    candidates: PublicationIdentityCandidate[]
): PublicationIdentityCollision | null {
    const match = candidates.find(candidate => candidate.taskId !== identity.taskId
        && candidate.canonicalProfile === identity.canonicalProfile
        && candidate.normalizedBodySha256 === identity.normalizedBodySha256);
    return match ? {
        task_id: match.taskId,
        fact_id: match.factId ?? null,
        public_url: match.publicUrl ?? null
    } : null;
}

export function countUniquePublicationIdentities(
    identities: Array<Pick<PublicationIdentityCandidate, 'canonicalProfile' | 'normalizedBodySha256'>>
): number {
    return new Set(identities.map(identity => `${identity.canonicalProfile}\u0000${identity.normalizedBodySha256}`)).size;
}

export function publicationIdentityKeyForCounting(item: {
    id: number;
    draft_text?: string | null;
    channel?: { type?: string | null; config: unknown } | null;
    publication_identity_claim?: {
        platform: string;
        canonical_profile_hash: string;
        normalized_body_sha256: string;
    } | null;
}): string {
    const claim = item.publication_identity_claim;
    if (claim) return `${claim.platform}:${claim.canonical_profile_hash}:${claim.normalized_body_sha256}`;
    if (String(item.channel?.type || '').toLowerCase() === 'medium' && item.channel && item.draft_text) {
        try {
            return `medium:${sha256(mediumProfileFromChannel(item.channel))}:${publicationBodySha256(item.draft_text)}`;
        } catch {
            // Legacy rows without a resolvable profile remain separate instead of being falsely collapsed.
        }
    }
    return `task:${item.id}`;
}

function duplicateError(collision: PublicationIdentityCollision): Error {
    return new Error(`[DUPLICATE_PUBLICATION_CANDIDATE] ${JSON.stringify(collision)}`);
}

function authorizationState(event: { id: number; after_state: unknown } | null, collision: PublicationIdentityCollision | null,
    profile: string, bodyHash: string) {
    if (!event || !collision?.fact_id) return null;
    const state = asRecord(event.after_state);
    if (state.authorized !== true || state.prior_fact_id !== collision.fact_id
        || state.canonical_profile !== profile || state.normalized_body_sha256 !== bodyHash) return null;
    return { eventId: event.id, overrideKey: `intentional-republish:${event.id}` };
}

export async function assertAndClaimPublicationIdentity(client: DbClient, args: {
    projectId: number;
    taskId: number;
    boundary: PublicationIdentityBoundary;
    body?: string;
    contentRevision?: number;
    reportedSourceIdentity?: unknown;
}): Promise<Record<string, unknown>> {
    const item = await client.contentItem.findFirst({
        where: { id: args.taskId, project_id: args.projectId },
        include: { channel: true, publication_fact: true }
    });
    if (!item) throw new Error('[PUBLICATION_TASK_NOT_FOUND]');
    if (String(item.channel?.type || '').toLowerCase() !== 'medium') return { enforced: false, platform: item.channel?.type || null };
    if (!item.channel_id || !item.channel) throw new Error('[MEDIUM_CHANNEL_REQUIRED] Medium task requires a channel');

    const body = args.body ?? item.draft_text ?? '';
    if (!normalizePublicationBody(body)) throw new Error('[PUBLICATION_BODY_REQUIRED] Medium body is empty');
    const canonicalProfile = mediumProfileFromChannel(item.channel);
    const normalizedBodySha256 = publicationBodySha256(body);
    const profileHash = sha256(canonicalProfile);

    const otherItems = await client.contentItem.findMany({
        where: {
            project_id: args.projectId,
            id: { not: item.id },
            draft_text: { not: null }
        },
        include: { channel: true, publication_fact: true }
    });
    const candidates: PublicationIdentityCandidate[] = [];
    for (const candidate of otherItems) {
        if (String(candidate.channel?.type || '').toLowerCase() !== 'medium' || !candidate.channel || !candidate.draft_text) continue;
        if (['cancelled', 'removed'].includes(candidate.status) && candidate.publication_fact?.outcome !== 'published') continue;
        let profile: string;
        try {
            profile = mediumProfileFromChannel(candidate.channel);
        } catch {
            continue;
        }
        candidates.push({
            taskId: candidate.id,
            canonicalProfile: profile,
            normalizedBodySha256: publicationBodySha256(candidate.draft_text),
            factId: candidate.publication_fact?.id,
            publicUrl: candidate.publication_fact?.public_url
        });
    }
    const collision = resolvePublicationIdentityCollision({
        taskId: item.id, canonicalProfile, normalizedBodySha256
    }, candidates);
    const authorizationEvent = await client.workflowEvent.findFirst({
        where: {
            project_id: args.projectId,
            content_item_id: item.id,
            command: 'ba_authorize_intentional_medium_republication'
        },
        orderBy: { id: 'desc' }
    });
    const authorization = authorizationState(authorizationEvent, collision, canonicalProfile, normalizedBodySha256);
    if (collision && !authorization) throw duplicateError(collision);
    const sourceIdentity = structuredSourceIdentity(item.source_refs);
    if (args.reportedSourceIdentity !== undefined) {
        assertReportedSourceLineage(args.reportedSourceIdentity, sourceIdentity);
    }
    const sourceIdentitySha256 = sha256(stableJson(sourceIdentity));

    const existing = await client.publicationIdentityClaim.findUnique({ where: { content_item_id: item.id } });
    if (existing) await client.publicationIdentityClaim.delete({ where: { id: existing.id } });
    const duplicateClaim = collision
        ? await client.publicationIdentityClaim.findFirst({
            where: {
                project_id: args.projectId,
                platform: 'medium',
                canonical_profile_hash: profileHash,
                normalized_body_sha256: normalizedBodySha256,
                override_key: ''
            }
        })
        : null;
    const overrideKey = authorization?.overrideKey || '';
    await client.publicationIdentityClaim.createMany({
        data: [{
            project_id: args.projectId,
            content_item_id: item.id,
            channel_id: item.channel_id,
            platform: 'medium',
            canonical_profile: canonicalProfile,
            canonical_profile_hash: profileHash,
            normalized_body_sha256: normalizedBodySha256,
            source_identity: sourceIdentity as Prisma.InputJsonValue,
            source_identity_sha256: sourceIdentitySha256,
            content_revision: args.contentRevision ?? item.content_revision,
            last_boundary: args.boundary,
            override_key: overrideKey,
            duplicate_of_claim_id: duplicateClaim?.id || null,
            authorization_event_id: authorization?.eventId || null
        }],
        skipDuplicates: true
    });
    const claimed = await client.publicationIdentityClaim.findUnique({ where: { content_item_id: item.id } });
    if (!claimed) {
        const competing = await client.publicationIdentityClaim.findFirst({
            where: {
                project_id: args.projectId,
                platform: 'medium',
                canonical_profile_hash: profileHash,
                normalized_body_sha256: normalizedBodySha256,
                override_key: overrideKey
            }
        });
        const competingItem = competing ? await client.contentItem.findFirst({
            where: { id: competing.content_item_id, project_id: args.projectId },
            include: { publication_fact: true }
        }) : null;
        throw duplicateError({
            task_id: competing?.content_item_id || 0,
            fact_id: competingItem?.publication_fact?.id || null,
            public_url: competingItem?.publication_fact?.public_url || null
        });
    }
    return {
        enforced: true,
        claim_id: claimed.id,
        canonical_profile: canonicalProfile,
        normalized_body_sha256: normalizedBodySha256,
        source_identity_sha256: sourceIdentitySha256,
        intentional_republication: Boolean(authorization)
    };
}

export async function assertAndClaimPublicationIdentityForTask(args: {
    projectId: number;
    taskId: number;
    boundary: PublicationIdentityBoundary;
    body?: string;
    contentRevision?: number;
    reportedSourceIdentity?: unknown;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(
        tx => assertAndClaimPublicationIdentity(tx, args),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
}

export default {
    assertAndClaim: assertAndClaimPublicationIdentity,
    assertAndClaimForTask: assertAndClaimPublicationIdentityForTask
};
