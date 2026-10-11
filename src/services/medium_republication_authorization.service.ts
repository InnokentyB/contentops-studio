import { Prisma } from '@prisma/client';
import prisma from '../db';
import {
    canonicalizeMediumProfile,
    mediumProfileFromChannel,
    publicationBodySha256,
    publicationIdentityRequestSha256,
    structuredSourceIdentity
} from './publication_identity.service';
import { requireProjectOwner } from './work_queue/auth';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

export interface AuthorizeMediumRepublicationArgs {
    projectId: number;
    actorId: string;
    taskId: number;
    priorFactId: number;
    expectedCanonicalProfile: string;
    expectedNormalizedBodySha256: string;
    reason: string;
    idempotencyKey: string;
}

/** Records exact owner authority for a deliberate duplicate without publishing or changing facts. */
export async function authorizeIntentionalMediumRepublication(
    args: AuthorizeMediumRepublicationArgs,
    database: typeof prisma = prisma
): Promise<Record<string, unknown>> {
    if (!args.reason.trim()) throw new Error('[REPUBLISH_REASON_REQUIRED]');
    return database.$transaction(async tx => {
        await requireProjectOwner(tx, args.projectId, args.actorId);
        const command = 'ba_authorize_intentional_medium_republication';
        const requestHash = publicationIdentityRequestSha256(args);
        const priorEvent = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (priorEvent) {
            const before = asRecord(priorEvent.before_state);
            if (before.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return asRecord(priorEvent.after_state);
        }
        const [target, priorFact] = await Promise.all([
            tx.contentItem.findFirst({
                where: { id: args.taskId, project_id: args.projectId },
                include: { channel: true, publication_fact: true }
            }),
            tx.publicationFact.findFirst({
                where: { id: args.priorFactId, project_id: args.projectId },
                include: { content_item: { include: { channel: true } } }
            })
        ]);
        if (!target || !target.channel || target.publication_fact) throw new Error('[REPUBLISH_TARGET_NOT_ELIGIBLE]');
        if (!priorFact || priorFact.outcome !== 'published' || !priorFact.public_url || !priorFact.content_item.channel) {
            throw new Error('[REPUBLISH_PRIOR_FACT_REQUIRED]');
        }
        const targetProfile = mediumProfileFromChannel(target.channel);
        const priorProfile = mediumProfileFromChannel(priorFact.content_item.channel);
        const targetBodyHash = publicationBodySha256(target.draft_text || '');
        const priorBodyHash = publicationBodySha256(priorFact.content_item.draft_text || '');
        structuredSourceIdentity(target.source_refs);
        if (targetProfile !== canonicalizeMediumProfile(args.expectedCanonicalProfile)
            || targetProfile !== priorProfile
            || targetBodyHash !== args.expectedNormalizedBodySha256
            || targetBodyHash !== priorBodyHash) throw new Error('[REPUBLISH_IDENTITY_MISMATCH]');

        const afterState = {
            authorized: true,
            target_task_id: target.id,
            prior_task_id: priorFact.content_item_id,
            prior_fact_id: priorFact.id,
            prior_public_url: priorFact.public_url,
            canonical_profile: targetProfile,
            normalized_body_sha256: targetBodyHash,
            reason: args.reason.trim()
        };
        const event = await tx.workflowEvent.create({ data: {
            project_id: args.projectId,
            content_item_id: target.id,
            actor_id: args.actorId,
            command,
            before_state: { request_hash: requestHash } as Prisma.InputJsonValue,
            after_state: afterState as Prisma.InputJsonValue,
            idempotency_key: args.idempotencyKey
        } });
        return { ...afterState, authorization_event_id: event.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
