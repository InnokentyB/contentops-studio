import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045PhaseAProbeIncident } from './dzen_task1045_phase_a_probe_contract';
import { DZEN1045_PHASE_A_V2, runDzen1045PhaseAV2,
    type Dzen1045DurableDraftProofV2 } from './dzen_task1045_phase_a_v2_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
export type Dzen1045PhaseAV2Args = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedSourcePhaseAIdempotencyKey: typeof DZEN1045_PHASE_A_V2.sourcePhaseAKey;
    expectedSourceFailedAt: typeof DZEN1045_PHASE_A_V2.sourceFailedAt;
    ownerAuthorizationReference: string; idempotencyKey: typeof DZEN1045_PHASE_A_V2.idempotencyKey;
    confirm?: boolean };

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function assetChecksum(task: Task): string {
    const provenance = object(task.selected_asset?.provenance);
    return string(object(provenance.planner_storage).sha256 || provenance.sha256);
}
function assertArgs(args: Dzen1045PhaseAV2Args): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedSourcePhaseAIdempotencyKey !== DZEN1045_PHASE_A_V2.sourcePhaseAKey
        || args.expectedSourceFailedAt !== DZEN1045_PHASE_A_V2.sourceFailedAt
        || args.idempotencyKey !== DZEN1045_PHASE_A_V2.idempotencyKey
        || !args.ownerAuthorizationReference.trim()) throw new Error('[DZEN1045_PHASE_A_V2_SCOPE_MISMATCH]');
    return Number(actor[1]);
}
function assertTask(task: Task | null): { task: Task; delivery: Record<string, unknown> } {
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    if (!task || task.id !== 1045 || task.project_id !== 10 || task.channel_id !== 116
        || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.visual_placement !== 'article_cover' || task.visual_state !== 'APPROVED'
        || task.visual_decision_version !== 1 || task.selected_asset_id !== 129
        || task.selected_asset?.status !== 'approved' || task.selected_asset.content_revision !== 4
        || assetChecksum(task) !== DZEN1045.assetSha || task.publication_fact || task.published_link) {
        throw new Error('[DZEN1045_PHASE_A_V2_TASK_MISMATCH]');
    }
    assertDzen1045PhaseAProbeIncident(delivery);
    return { task, delivery };
}
function proofFromState(value: unknown): Dzen1045DurableDraftProofV2 | null {
    const proof = object(value).proof as Dzen1045DurableDraftProofV2 | undefined;
    return proof?.draftId ? proof : null;
}

/** Exact owner-authorized correction for the frozen Phase A incident. No final-submit or fact port. */
export async function createDzenTask1045DurableDraftPhaseAV2(args: Dzen1045PhaseAV2Args) {
    const userId = assertArgs(args); const proofCommand = `${DZEN1045_PHASE_A_V2.command}_proof`;
    const [member, manifest, task, prior, proofEvent] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: DZEN1045_PHASE_A_V2.command, idempotency_key: DZEN1045_PHASE_A_V2.idempotencyKey } }),
        prisma.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
            command: proofCommand, idempotency_key: DZEN1045_PHASE_A_V2.idempotencyKey } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    if (prior) {
        const proof = proofFromState(proofEvent?.after_state);
        if (!proof) throw new Error('[DZEN1045_PHASE_A_V2_ALREADY_CLAIMED] Reconcile; never create again');
        return { mode: 'draft_proven', proof, replayed: true, published: false };
    }
    const guarded = assertTask(task);
    const config = resolveEffectiveChannelConfig('dzen', guarded.task.channel!.config || {});
    const imageUrl = guarded.task.selected_asset!.file_url;
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId || !imageUrl) {
        throw new Error('[DZEN1045_PHASE_A_V2_CONNECTOR_NOT_READY]');
    }
    let claimed = false;
    try {
        const result = await runDzen1045PhaseAV2({ confirm: args.confirm === true,
            idempotencyKey: args.idempotencyKey }, {
            inspect: () => dzenService.inspectTask1045RestoreIncident(config, guarded.task.draft_text || ''),
            claim: async inspection => prisma.$transaction(async tx => {
                const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
                    include: { channel: true, selected_asset: true, publication_fact: true } });
                const exact = assertTask(latest);
                if (await tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1045,
                    command: DZEN1045_PHASE_A_V2.command,
                    idempotency_key: DZEN1045_PHASE_A_V2.idempotencyKey } })) return false;
                const quality = object(latest?.quality_report);
                const changed = await tx.contentItem.updateMany({ where: { id: 1045, project_id: 10,
                    status: 'publishing', publication_mode: 'owner_released', channel_id: 116,
                    content_revision: 4, accepted_revision: 4, selected_asset_id: 129,
                    quality_report: { equals: latest!.quality_report || {} }, publication_fact: { is: null },
                    published_link: null }, data: { quality_report: { ...quality,
                    publication_task_delivery: { ...exact.delivery, state: 'draft_phase_a_v2_started',
                        phase_a_v2_idempotency_key: DZEN1045_PHASE_A_V2.idempotencyKey,
                        owner_authorization_reference: args.ownerAuthorizationReference,
                        draft_create_count_max: 1, final_submit_allowed: false,
                        phase_a_v2_started_at: new Date().toISOString(), retry_via_api: false }
                } as Prisma.InputJsonValue } });
                if (changed.count !== 1) return false;
                await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                    actor_id: args.actorId, command: DZEN1045_PHASE_A_V2.command,
                    idempotency_key: DZEN1045_PHASE_A_V2.idempotencyKey,
                    before_state: { source_phase_a_key: DZEN1045_PHASE_A_V2.sourcePhaseAKey,
                        source_failed_at: DZEN1045_PHASE_A_V2.sourceFailedAt,
                        inventory: inspection } as Prisma.InputJsonValue,
                    after_state: { state: 'draft_phase_a_v2_started', final_submit_allowed: false,
                        body_sha256: DZEN1045.bodySha, asset_sha256: DZEN1045.assetSha,
                        exact_menu_contract: 'Написать статью' } as Prisma.InputJsonValue } });
                claimed = true; return true;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
            createAndPersist: () => dzenService.createTask1045DurableDraftPhaseAV2(config,
                guarded.task.draft_text || '', imageUrl)
        });
        if (result.mode === 'preview') return { ...result, published: false, replayed: false };
        await prisma.$transaction(async tx => {
            const latest = await tx.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(latest?.quality_report); const delivery = object(quality.publication_task_delivery);
            if (delivery.state !== 'draft_phase_a_v2_started'
                || delivery.phase_a_v2_idempotency_key !== DZEN1045_PHASE_A_V2.idempotencyKey) {
                throw new Error('[DZEN1045_PHASE_A_V2_CAS_CONFLICT]');
            }
            await tx.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...delivery, state: 'draft_phase_a_v2_proven',
                    durable_draft_proof_v2: result.proof, phase_a_v2_completed_at: new Date().toISOString(),
                    final_submit_allowed: false, retry_via_api: false } } as Prisma.InputJsonValue } });
            await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1045,
                actor_id: args.actorId, command: proofCommand,
                idempotency_key: DZEN1045_PHASE_A_V2.idempotencyKey,
                after_state: { proof: result.proof, provider_writes: 'acknowledged_draft_persistence_only',
                    final_submit_count: 0, publication_fact_created: false } as Prisma.InputJsonValue } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { ...result, published: false, publication_fact_created: false, replayed: false };
    } catch (error: unknown) {
        if (claimed) {
            const current = await prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 } });
            const quality = object(current?.quality_report); const delivery = object(quality.publication_task_delivery);
            await prisma.contentItem.update({ where: { id: 1045 }, data: { quality_report: { ...quality,
                publication_task_delivery: { ...delivery, state: 'draft_phase_a_v2_uncertain',
                    draft_create_may_have_occurred: true, final_submit_allowed: false,
                    final_submit_count: 0, retry_via_api: false,
                    error: error instanceof Error ? error.message : String(error),
                    phase_a_v2_failed_at: new Date().toISOString() } } as Prisma.InputJsonValue } });
        }
        throw error;
    }
}
