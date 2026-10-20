import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import factService from './publication_fact.service';
import { createOwnerManualFactPolicy } from './owner_manual_fact_policy';
import { ownerManualFactReadback } from './owner_manual_publication_readback';
import { ownerManualLocks, ownerManualPrincipal } from './owner_manual_publication_guard';
import { ownerManualFactSha, ownerManualSnapshot, ownerManualPreserved } from './owner_manual_publication_provenance';
import { OWNER_MANUAL_EVENT, OWNER_MANUAL_EVIDENCE_PREFIX, ownerManualPreviewSchema, ownerManualCommitSchema, ownerManualDigest, ownerManualError, ownerManualObject, type OwnerManualInput, type OwnerManualProvenance } from './owner_manual_publication_contract';
import { runOwnedInvocation } from './owned_publication_invocation';
import {ownerManualObjectAliases} from './owner_manual_publication_identity';
function parse<T>(schema: {
    safeParse(value: unknown): {
        success: true;
        data: T;
    } | {
        success: false;
    };
}, raw: unknown): T {
    if (Buffer.byteLength(JSON.stringify(raw) ?? '') > 65536)
        throw ownerManualError('INPUT_INVALID');
    const result = schema.safeParse(raw);
    if (!result.success)
        throw ownerManualError('INPUT_INVALID');
    return result.data;
}
async function packet(tx: Prisma.TransactionClient, input: OwnerManualInput) {
    await tx.$queryRaw `SELECT set_config('lock_timeout','5000',true),set_config('statement_timeout','20000',true)`;
    const { principal, identity } = await ownerManualLocks(tx, input);
    const snapshot = { ...await ownerManualSnapshot(tx, input.projectId, input.taskId), custody_sha256: ownerManualDigest(await ownerManualPreserved(tx, input.projectId, input.taskId)) };
    const manifest_checksum = (await loadAgentWorkspaceManifest(input.projectId, principal.userId, tx)).checksum;
    const provenance: OwnerManualProvenance = { origin: 'owner_attested_v1', time_basis: input.timeBasis, published_at_original: input.publishedAt, published_at_canonical: new Date(input.publishedAt).toISOString(), published_at_precision: 'milliseconds', revision_binding: 'external_object_only', published_revision: null, published_revision_body_sha256: null, owner_confirmation_reference: input.ownerConfirmationReference, owner_actor_id: principal.actorId };
    const binding = { projectId: input.projectId, taskId: input.taskId, canonical_identity: identity, provenance, manifest_checksum, ...snapshot };
    return { ...binding, revision_binding: provenance.revision_binding, preview_hash: ownerManualDigest(binding) };
}
class ExactReplay extends Error {
    constructor(readonly result: Record<string, unknown>) { super('exact replay'); }
}
export class OwnerManualPublicationService {
    async preview(raw: unknown) {
        const input = parse(ownerManualPreviewSchema, raw);
        ownerManualPrincipal(input.projectId);
        return prisma.$transaction(tx => packet(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });
    }
    async commit(raw: unknown) {
        const invocationDeadline = Date.now() + 30000;
        const input = parse(ownerManualCommitSchema, raw), principal = ownerManualPrincipal(input.projectId);
        const base = ownerManualPreviewSchema.parse(Object.fromEntries(Object.entries(input).filter(([k]) => !['previewHash', 'expectedManifestChecksum', 'expectedFactSha256', 'idempotencyKey', 'correctionReason'].includes(k))));
        if ([input.idempotencyKey, input.correctionReason || ''].some(value => /(?:bearer\s|authorization|cookie\s*[:=]|access[_-]?token|token\s*=)/i.test(value)))
            throw ownerManualError('REFERENCE_INVALID');
        const request = ownerManualDigest(input);
        let prepared: Awaited<ReturnType<typeof packet>> | undefined;
        let preserved: Awaited<ReturnType<typeof ownerManualPreserved>> = [];
        let auditId: number | undefined;
        let factAuditIds: number[] = [];
        let writtenFactSha: string | null = null;
        let auditStateSha: string | undefined;
        const policy = createOwnerManualFactPolicy({ beforeWrite: async (tx) => {
                prepared = await packet(tx, base);
                preserved = await ownerManualPreserved(tx, input.projectId, input.taskId);
                const replay = await tx.workflowEvent.findFirst({ where: { project_id: input.projectId, actor_id: principal.actorId, command: OWNER_MANUAL_EVENT, idempotency_key: input.idempotencyKey }, select: { after_state: true } });
                if (replay) {
                    const state = ownerManualObject(replay.after_state);
                    if (state.request_sha256 !== request || state.publication_fact_sha256 !== prepared.expected_fact_sha256)
                        throw ownerManualError('IDEMPOTENCY_CONFLICT');
                    const fact = await tx.publicationFact.findFirst({ where: { project_id: input.projectId, content_item_id: input.taskId } });
                    if (!fact)
                        throw ownerManualError('IDEMPOTENCY_CONFLICT');
                    throw new ExactReplay({ publication_fact: { ...fact, ...await ownerManualFactReadback(tx, fact) }, provenance: state.provenance, replayed: true, created_checkpoints: 0 });
                }
                if (prepared.preview_hash !== input.previewHash || prepared.manifest_checksum !== input.expectedManifestChecksum || prepared.expected_fact_sha256 !== input.expectedFactSha256)
                    throw ownerManualError('STALE_PREVIEW');
                if (prepared.expected_fact_sha256 && !input.correctionReason)
                    throw ownerManualError('CORRECTION_REQUIRED');
                const lockKey = `owner-manual:${input.projectId}:${prepared.canonical_identity.provider}:${prepared.canonical_identity.object_id}`;
                await tx.$queryRaw `SELECT pg_advisory_xact_lock(hashtextextended(${lockKey},0))::text`;
                const identity = prepared.canonical_identity;
                const aliases = ownerManualObjectAliases(identity.provider, identity.object_id);
                const alternateId = identity.provider === 'vk' ? `wall${identity.object_id}` : identity.object_id;
                const collision = await tx.$queryRaw<Array<{id: number}>>(Prisma.sql`
                    SELECT f.id FROM planner.publication_facts f
                    JOIN planner.social_channels c ON c.id=f.channel_id AND c.project_id=f.project_id
                    WHERE f.project_id=${input.projectId} AND f.content_item_id<>${input.taskId}
                    AND c.type=${identity.provider}
                    AND (f.provider_object_id IN (${identity.object_id},${alternateId})
                      OR regexp_replace(f.public_url,'[?#].*$','') IN (${Prisma.join(aliases)})) LIMIT 1`);
                if (collision.length)
                    throw ownerManualError('OBJECT_CONFLICT');
            }, afterWrite: async (tx, factId) => {
                if (!prepared)
                    throw ownerManualError('UNAVAILABLE');
                writtenFactSha = await ownerManualFactSha(tx, input.projectId, input.taskId);
                const auditState = { version: 1, publication_fact_id: factId, publication_fact_sha256: writtenFactSha, request_sha256: request, preview_hash: input.previewHash, canonical_identity: prepared.canonical_identity, provenance: prepared.provenance, previous_fact_sha256: input.expectedFactSha256, custody_sha256: prepared.custody_sha256, task_snapshot_sha256: prepared.task_snapshot_sha256, manifest_checksum: prepared.manifest_checksum, correction_reason: input.correctionReason || null };
                auditStateSha = ownerManualDigest(auditState);
                const audit = await tx.workflowEvent.create({ data: { project_id: input.projectId, content_item_id: input.taskId, actor_id: principal.actorId, command: OWNER_MANUAL_EVENT, idempotency_key: input.idempotencyKey, before_state: { publication_fact_sha256: input.expectedFactSha256 }, after_state: auditState as Prisma.InputJsonValue } });
                auditId = audit.id;
                const events = await tx.workflowEvent.findMany({ where: { project_id: input.projectId, content_item_id: input.taskId, command: { in: ['publication_fact.created', 'publication_fact.corrected'] } }, select: { id: true } });
                factAuditIds = events.filter(e => !preserved.some(row => row.kind === 'event' && row.id === String(e.id))).map(e => e.id);
            }, beforeCommit: async (tx) => {
                if (!prepared || auditId === undefined || factAuditIds.length !== 1)
                    throw ownerManualError('UNAVAILABLE');
                await ownerManualLocks(tx, base);
                if ((await loadAgentWorkspaceManifest(input.projectId, principal.userId, tx)).checksum !== input.expectedManifestChecksum)
                    throw ownerManualError('STALE_PREVIEW');
                const audit = await tx.workflowEvent.findUnique({ where: { id: auditId }, select: { after_state: true } });
                if (!writtenFactSha || writtenFactSha !== await ownerManualFactSha(tx, input.projectId, input.taskId) || ownerManualDigest(audit?.after_state) !== auditStateSha)
                    throw ownerManualError('STALE_PREVIEW');
                const after = await ownerManualPreserved(tx, input.projectId, input.taskId);
                const excluded = new Set([String(auditId), ...factAuditIds.map(String)]);
                if (ownerManualDigest(after.filter(row => (row.kind !== 'event' || !excluded.has(row.id)) && (!['metric_work', 'checkpoint'].includes(row.kind) || preserved.some(prior => prior.kind === row.kind && prior.id === row.id)))) !== ownerManualDigest(preserved))
                    throw ownerManualError('STALE_PREVIEW');
            } });
        // Only validated local data is prepared here; the canonical writer rechecks it under its transaction.
        const preview = await this.preview(base);
        const controller = new AbortController();
        try {
            const result = await runOwnedInvocation({ signal: controller.signal, deadline: Math.min(invocationDeadline, Date.now() + 20000) }, () => factService.record({ projectId: input.projectId, taskId: input.taskId, actorId: principal.actorId, artifactKind: preview.canonical_identity.provider === 'vk' ? 'post' : 'article', outcome: 'published', publishedAt: preview.provenance.published_at_canonical, publicUrl: preview.canonical_identity.public_url, providerObjectId: preview.canonical_identity.object_id, confirmationMode: 'manual', evidence: { type: 'manual_note', ref: `${OWNER_MANUAL_EVIDENCE_PREFIX}${request}` }, correctionReason: input.correctionReason, ownerManualPolicy: policy }));
            return { ...result, provenance: prepared?.provenance };
        }
        catch (error: unknown) {
            if (error instanceof ExactReplay)
                return error.result;
            throw error;
        }
    }
}
export const ownerManualPublicationService = new OwnerManualPublicationService();
