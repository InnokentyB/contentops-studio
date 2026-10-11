import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045RestoreReconcileTask } from './dzen_task1045_restore_reconcile.service';
import { DZEN1045_PHASE_A, runDzen1045PhaseA, type Dzen1045DurableDraftProof } from './dzen_task1045_phase_a_contract';

export type Dzen1045PhaseAArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedSourceRestoreIdempotencyKey: typeof DZEN1045_PHASE_A.sourceRestoreKey;
    expectedSourceFailedAt: typeof DZEN1045_PHASE_A.sourceFailedAt;
    ownerAuthorizationReference: string; idempotencyKey: typeof DZEN1045_PHASE_A.idempotencyKey;
    confirm?: boolean };
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function assertArgs(args: Dzen1045PhaseAArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedSourceRestoreIdempotencyKey !== DZEN1045_PHASE_A.sourceRestoreKey
        || args.expectedSourceFailedAt !== DZEN1045_PHASE_A.sourceFailedAt
        || args.idempotencyKey !== DZEN1045_PHASE_A.idempotencyKey
        || !args.ownerAuthorizationReference.trim()) throw new Error('[DZEN1045_PHASE_A_SCOPE_MISMATCH]');
    return Number(actor[1]);
}
function proofFromState(value: unknown): Dzen1045DurableDraftProof | null {
    const proof = object(value).proof as Dzen1045DurableDraftProof | undefined;
    return proof?.draftId ? proof : null;
}

/** Owner-authorized Phase A: create and prove one durable draft; never submits or records a fact. */
export async function createDzenTask1045DurableDraftPhaseA(args: Dzen1045PhaseAArgs) {
    const userId = assertArgs(args); const proofCommand = `${DZEN1045_PHASE_A.command}_proof`;
    const [member, manifest, task, prior, proofEvent] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_PHASE_A.command, idempotency_key: DZEN1045_PHASE_A.idempotencyKey } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: proofCommand, idempotency_key: DZEN1045_PHASE_A.idempotencyKey } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior) {
        const proof = proofFromState(proofEvent?.after_state);
        if (!proof) throw new Error('[DZEN1045_PHASE_A_ALREADY_CLAIMED] Reconcile Phase A; never create again');
        return { mode: 'draft_proven', proof, replayed: true, published: false };
    }
    const guarded = assertDzen1045RestoreReconcileTask(task);
    const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel?.config || {});
    const imageUrl = guarded.task.selected_asset?.file_url;
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId || !imageUrl) {
        throw new Error('[DZEN1045_PHASE_A_CONNECTOR_NOT_READY]');
    }
    let claimed = false;
    try {
        const result = await runDzen1045PhaseA({ confirm: args.confirm === true,
            idempotencyKey: args.idempotencyKey }, {
            inspect: () => dzenService.inspectTask1045RestoreIncident(config, guarded.task.draft_text || ''),
            claim: async inspection => prisma.$transaction(async tx => {
                const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } });
                const exact = assertDzen1045RestoreReconcileTask(latest);
                if (await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
                    command: DZEN1045_PHASE_A.command, idempotency_key: DZEN1045_PHASE_A.idempotencyKey } })) return false;
                const quality = object(latest?.quality_report);
                const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    status: 'publishing', publication_mode: 'owner_released', channel_id: 116,
                    content_revision: 4, accepted_revision: 4, selected_asset_id: 129,
                    quality_report: { equals: latest!.quality_report || {} }, publication_fact: { is: null },
                    published_link: null }, data: { quality_report: { ...quality,
                    publication_task_delivery: { ...exact.delivery, state: 'draft_phase_a_started',
                        phase_a_idempotency_key: DZEN1045_PHASE_A.idempotencyKey,
                        owner_authorization_reference: args.ownerAuthorizationReference,
                        draft_create_count_max: 1, final_submit_allowed: false,
                        phase_a_started_at: new Date().toISOString(), retry_via_api: false }
                } as Prisma.InputJsonValue } });
                if (changed.count !== 1) return false;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: DZEN1045_PHASE_A.command,
                    idempotency_key: DZEN1045_PHASE_A.idempotencyKey,
                    before_state: { source_restore_key: DZEN1045_PHASE_A.sourceRestoreKey,
                        source_failed_at: DZEN1045_PHASE_A.sourceFailedAt, inventory: inspection } as Prisma.InputJsonValue,
                    after_state: { state: 'draft_phase_a_started', final_submit_allowed: false,
                        body_sha256: DZEN1045.bodySha, asset_sha256: DZEN1045.assetSha } as Prisma.InputJsonValue } });
                claimed = true; return true;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
            createAndPersist: () => dzenService.createTask1045DurableDraftPhaseA(config,
                guarded.task.draft_text || '', imageUrl)
        });
        if (result.mode === 'preview') return { ...result, published: false, replayed: false };
        await prisma.$transaction(async tx => {
            const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(latest?.quality_report); const delivery = object(quality.publication_task_delivery);
            if (delivery.state !== 'draft_phase_a_started'
                || delivery.phase_a_idempotency_key !== DZEN1045_PHASE_A.idempotencyKey) {
                throw new Error('[DZEN1045_PHASE_A_CAS_CONFLICT]');
            }
            await tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...delivery, state: 'draft_phase_a_proven',
                    durable_draft_proof: result.proof, phase_a_completed_at: new Date().toISOString(),
                    final_submit_allowed: false, retry_via_api: false } } as Prisma.InputJsonValue } });
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                actor_id: args.actorId, command: proofCommand, idempotency_key: DZEN1045_PHASE_A.idempotencyKey,
                after_state: { proof: result.proof, provider_writes: 'draft_persistence_only',
                    final_submit_count: 0, publication_fact_created: false } as Prisma.InputJsonValue } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { ...result, published: false, publication_fact_created: false, replayed: false };
    } catch (error: unknown) {
        if (claimed) {
            const current = await prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(current?.quality_report); const delivery = object(quality.publication_task_delivery);
            await prisma.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...delivery, state: 'draft_phase_a_uncertain',
                    draft_create_may_have_occurred: true, final_submit_allowed: false,
                    final_submit_count: 0, retry_via_api: false,
                    error: error instanceof Error ? error.message : String(error),
                    failed_at: new Date().toISOString() } } as Prisma.InputJsonValue } });
        }
        throw error;
    }
}
