import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045PhaseAV2Incident, DZEN1045_PHASE_A_V2_RECONCILE,
    runDzen1045PhaseAV2Reconcile } from './dzen_task1045_phase_a_v2_reconcile_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
export type Dzen1045PhaseAV2ReconcileArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedSourcePhaseAIdempotencyKey: typeof DZEN1045_PHASE_A_V2_RECONCILE.sourceKey;
    expectedFailedAt: typeof DZEN1045_PHASE_A_V2_RECONCILE.failedAt;
    expectedProviderId: typeof DZEN1045_PHASE_A_V2_RECONCILE.providerId;
    expectedNumericProviderId: typeof DZEN1045_PHASE_A_V2_RECONCILE.numericProviderId;
    expectedImageId: typeof DZEN1045_PHASE_A_V2_RECONCILE.imageId;
    ownerAuthorizationReference: string;
    idempotencyKey: typeof DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey; confirm?: boolean };
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function assetChecksum(task: Task): string { const provenance = object(task.selected_asset?.provenance);
    return string(object(provenance.planner_storage).sha256 || provenance.sha256); }
function assertArgs(args: Dzen1045PhaseAV2ReconcileArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedSourcePhaseAIdempotencyKey !== DZEN1045_PHASE_A_V2_RECONCILE.sourceKey
        || args.expectedFailedAt !== DZEN1045_PHASE_A_V2_RECONCILE.failedAt
        || args.expectedProviderId !== DZEN1045_PHASE_A_V2_RECONCILE.providerId
        || args.expectedNumericProviderId !== DZEN1045_PHASE_A_V2_RECONCILE.numericProviderId
        || args.expectedImageId !== DZEN1045_PHASE_A_V2_RECONCILE.imageId
        || args.idempotencyKey !== DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey
        || !args.ownerAuthorizationReference.trim()) throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_SCOPE_MISMATCH]');
    return Number(actor[1]);
}
function assertTask(task: Task | null) {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.visual_decision_version !== 1 || task.selected_asset_id !== 129
        || task.selected_asset?.status !== 'approved' || task.selected_asset.content_revision !== 4
        || assetChecksum(task) !== DZEN1045.assetSha || task.publication_fact || task.published_link) {
        throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_TASK_MISMATCH]');
    }
    assertDzen1045PhaseAV2Incident(delivery); return { task, delivery };
}
async function loadTask() { return prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
    include: { channel: true, selected_asset: true, publication_fact: true } }); }
async function recordFact(args: Dzen1045PhaseAV2ReconcileArgs, publication: Dzen1045SecondAttemptPublication) {
    return publicationFactService.record({ projectId: 10, taskId: 1045, actorId: args.actorId,
        artifactKind: 'article', outcome: 'published', publicUrl: publication.public_url,
        providerObjectId: publication.provider_object_id, publishedAt: publication.published_at,
        confirmationMode: 'reconciled', evidence: { type: 'public_url', ref: publication.public_url },
        utmStatus: 'not_applicable', note: 'Exact read-only reconciliation of Dzen task1045 Phase A V2.' });
}

export async function reconcileDzenTask1045PhaseAV2Incident(args: Dzen1045PhaseAV2ReconcileArgs) {
    const userId = assertArgs(args);
    const [member, manifest, task, prior] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId), loadTask(),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_PHASE_A_V2_RECONCILE.command,
            idempotency_key: DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior && args.confirm) {
        const after = object(prior.after_state); const mode = string(after.mode);
        if (mode === 'exact_durable_draft') return { mode: 'draft_reconciled',
            draft: after.draft, replayed: true, published: false };
        if (mode === 'exact_published') {
            const publication = after.publication as Dzen1045SecondAttemptPublication;
            return { mode: 'published_reconciled', publication,
                fact: await recordFact(args, publication), replayed: true };
        }
        throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_AUDIT_INVALID]');
    }
    const guarded = assertTask(task);
    const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel!.config || {});
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_CONNECTOR_NOT_READY]');
    }
    return runDzen1045PhaseAV2Reconcile({ confirm: args.confirm === true,
        idempotencyKey: args.idempotencyKey }, {
        inspect: () => dzenService.inspectTask1045PhaseAV2Incident(config, guarded.task.draft_text || ''),
        applyDraft: async draft => prisma.$transaction(async tx => {
            const latest = assertTask(await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                include: { channel: true, selected_asset: true, publication_fact: true } }));
            const quality = object(latest.task.quality_report);
            const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                quality_report: { equals: latest.task.quality_report || {} }, publication_fact: { is: null },
                published_link: null }, data: { quality_report: { ...quality, publication_task_delivery: {
                    ...latest.delivery, state: 'draft_phase_a_v2_proven', final_submit_allowed: true,
                    retry_via_api: false, phase_a_v2_reconciled_at: new Date().toISOString(),
                    reconciled_durable_draft: draft } } as Prisma.InputJsonValue } });
            if (changed.count !== 1) throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_CAS_CONFLICT]');
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                actor_id: args.actorId, command: DZEN1045_PHASE_A_V2_RECONCILE.command,
                idempotency_key: DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey,
                before_state: { source_key: DZEN1045_PHASE_A_V2_RECONCILE.sourceKey,
                    failed_at: DZEN1045_PHASE_A_V2_RECONCILE.failedAt } as Prisma.InputJsonValue,
                after_state: { mode: 'exact_durable_draft', draft, provider_writes: 0,
                    final_submit_allowed: true } as Prisma.InputJsonValue } });
            return { draft, final_submit_allowed: true, publication_fact_created: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
        applyPublished: async publication => {
            await prisma.$transaction(async tx => {
                assertTask(await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } }));
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: DZEN1045_PHASE_A_V2_RECONCILE.command,
                    idempotency_key: DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey,
                    after_state: { mode: 'exact_published', publication, provider_writes: 0 } as Prisma.InputJsonValue } });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            return recordFact(args, publication);
        }
    });
}
