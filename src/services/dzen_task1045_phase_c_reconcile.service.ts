import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045, normalizeDzen1045Body } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045PhaseCIncident, DZEN1045_PHASE_C_RECONCILE,
    runDzen1045PhaseCReconcile, type Dzen1045PhaseCReconcileInspection }
    from './dzen_task1045_phase_c_reconcile_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
type Args = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedPhaseCIdempotencyKey: typeof DZEN1045_PHASE_C_RECONCILE.sourceKey;
    expectedSemanticFingerprint: typeof DZEN1045_PHASE_C_RECONCILE.semanticFingerprint;
    expectedStartedAt: typeof DZEN1045_PHASE_C_RECONCILE.startedAt;
    expectedFailedAt: typeof DZEN1045_PHASE_C_RECONCILE.failedAt;
    expectedProviderId: typeof DZEN1045_PHASE_C_RECONCILE.providerId;
    ownerAuthorizationReference: string; idempotencyKey: typeof DZEN1045_PHASE_C_RECONCILE.idempotencyKey;
    confirm?: boolean };
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object'
    && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function assetChecksum(task: Task): string { const provenance = object(task.selected_asset?.provenance);
    return String(object(provenance.planner_storage).sha256 || provenance.sha256 || ''); }
function assertArgs(args: Args): number { const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedPhaseCIdempotencyKey !== DZEN1045_PHASE_C_RECONCILE.sourceKey
        || args.expectedSemanticFingerprint !== DZEN1045_PHASE_C_RECONCILE.semanticFingerprint
        || args.expectedStartedAt !== DZEN1045_PHASE_C_RECONCILE.startedAt
        || args.expectedFailedAt !== DZEN1045_PHASE_C_RECONCILE.failedAt
        || args.expectedProviderId !== DZEN1045_PHASE_C_RECONCILE.providerId
        || args.idempotencyKey !== DZEN1045_PHASE_C_RECONCILE.idempotencyKey
        || !args.ownerAuthorizationReference.trim()) throw new Error('[DZEN1045_PHASE_C_RECONCILE_SCOPE_MISMATCH]');
    return Number(actor[1]); }
function assertTask(task: Task | null) { const delivery = object(object(task?.quality_report).publication_task_delivery);
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.selected_asset_id !== 129 || assetChecksum(task) !== DZEN1045.assetSha
        || task.publication_fact || task.published_link) throw new Error('[DZEN1045_PHASE_C_RECONCILE_TASK_MISMATCH]');
    assertDzen1045PhaseCIncident(delivery); return { task, delivery }; }

async function inspect(config: Record<string, unknown>, body: string): Promise<Dzen1045PhaseCReconcileInspection> {
    const inventory = await dzenService.inspectTask1045PhaseAV2Incident(config, body);
    const normalized = normalizeDzen1045Body(body);
    const evidence = { provider_writes: 0, clicked_controls: 0, publisher_id: DZEN1045.publisherId,
        provider_id: DZEN1045_PHASE_C_RECONCILE.providerId, accepted_revision: 4,
        accepted_body_sha256: DZEN1045.bodySha,
        accepted_normalized_sha256: createHash('sha256').update(normalized).digest('hex'),
        accepted_normalized_length: normalized.length, accepted_cover_sha256: DZEN1045.assetSha,
        inventory, inspected_at: new Date().toISOString() };
    if (inventory.kind === 'exact_published'
        && inventory.publication.provider_object_id === DZEN1045_PHASE_C_RECONCILE.providerId) {
        return { kind: 'exact_public', publication: inventory.publication, evidence };
    }
    if (inventory.kind === 'exact_durable_draft') return { kind: 'exact_draft', evidence };
    return { kind: 'ambiguous', evidence };
}
async function recordFact(args: Args, publication: Dzen1045SecondAttemptPublication) {
    const fact = await publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
        artifactKind: 'article', outcome: 'published', publicUrl: publication.public_url,
        providerObjectId: publication.provider_object_id, publishedAt: publication.published_at,
        confirmationMode: 'reconciled', evidence: { type: 'public_url', ref: publication.public_url },
        utmStatus: 'not_applicable', note: 'Provider-read-only reconciliation of exact Dzen task1045 Phase C incident.' });
    await prisma.$transaction(async tx => {
        const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
        const quality = object(latest?.quality_report); const delivery = object(quality.publication_task_delivery);
        await tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
            publication_task_delivery: { ...delivery, state: 'phase_c_reconciled_published',
                final_submit_allowed: false, final_submit_may_have_occurred: true, final_submit_count: 1,
                phase_c_reconciled_at: new Date().toISOString(), publication } } as Prisma.InputJsonValue } });
        const proof = await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: `${DZEN1045_PHASE_C_RECONCILE.command}_proof`, idempotency_key: DZEN1045_PHASE_C_RECONCILE.idempotencyKey } });
        if (!proof) await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
            actor_id: args.actorId, command: `${DZEN1045_PHASE_C_RECONCILE.command}_proof`,
            idempotency_key: DZEN1045_PHASE_C_RECONCILE.idempotencyKey,
            after_state: { publication_fact_id: fact.publication_fact.id, publication,
                created_checkpoints: fact.created_checkpoints } as Prisma.InputJsonValue } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const checkpoints = await prisma.metricSnapshot.findMany({ where: { project_id: 10,
        content_item_id: 1045, channel_id: 116 }, orderBy: { id: 'asc' } });
    return { ...fact, checkpoint_ids: checkpoints.map(item => item.id),
        checkpoints: checkpoints.map(item => ({ id: item.id, checkpoint: item.checkpoint,
            collection_status: item.collection_status })) };
}

export async function reconcileDzenTask1045PhaseCIncident(args: Args) {
    const userId = assertArgs(args); const confirm = args.confirm === true;
    const [member, manifest, task, prior] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_PHASE_C_RECONCILE.command,
            idempotency_key: DZEN1045_PHASE_C_RECONCILE.idempotencyKey } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior && confirm) { const after = object(prior.after_state);
        if (after.mode !== 'exact_public') throw new Error('[DZEN1045_PHASE_C_RECONCILE_AUDIT_INVALID]');
        return { mode: 'reconciled', replayed: true,
            result: await recordFact(args, after.publication as Dzen1045SecondAttemptPublication) }; }
    const guarded = assertTask(task); const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel!.config || {});
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_PHASE_C_RECONCILE_CONNECTOR_NOT_READY]');
    }
    return runDzen1045PhaseCReconcile({ confirm, idempotencyKey: args.idempotencyKey }, {
        inspect: () => inspect(config, guarded.task.draft_text || ''),
        record: async publication => {
            await prisma.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                actor_id: args.actorId, command: DZEN1045_PHASE_C_RECONCILE.command,
                idempotency_key: DZEN1045_PHASE_C_RECONCILE.idempotencyKey,
                before_state: { state: 'phase_c_uncertain', source_key: DZEN1045_PHASE_C_RECONCILE.sourceKey,
                    failed_at: DZEN1045_PHASE_C_RECONCILE.failedAt } as Prisma.InputJsonValue,
                after_state: { mode: 'exact_public', publication, provider_writes: 0,
                    clicked_controls: 0 } as Prisma.InputJsonValue } });
            return recordFact(args, publication);
        }
    });
}
