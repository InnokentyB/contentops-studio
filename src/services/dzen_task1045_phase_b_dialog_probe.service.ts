import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import dzenService from './dzen.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { DZEN1045_PHASE_B_RECONCILE, DZEN1045_PHASE_B_DIALOG_PROBE }
    from './dzen_task1045_phase_b_reconcile_contract';

type Task = Prisma.ContentItemGetPayload<{ include: { channel: true; selected_asset: true; publication_fact: true } }>;
export type Dzen1045PhaseBDialogProbeArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedReconcileIdempotencyKey: typeof DZEN1045_PHASE_B_DIALOG_PROBE.sourceReconcileKey;
    expectedRecordedAt: typeof DZEN1045_PHASE_B_DIALOG_PROBE.recordedAt;
    expectedProviderId: typeof DZEN1045_PHASE_B_RECONCILE.providerId;
    idempotencyKey: typeof DZEN1045_PHASE_B_DIALOG_PROBE.idempotencyKey };
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object'
    && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function checksum(task: Task): string { const provenance = object(task.selected_asset?.provenance);
    return String(object(provenance.planner_storage).sha256 || provenance.sha256 || ''); }
export async function probeDzenTask1045PhaseBDialog(args: Dzen1045PhaseBDialogProbeArgs) {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedReconcileIdempotencyKey !== DZEN1045_PHASE_B_DIALOG_PROBE.sourceReconcileKey
        || args.expectedRecordedAt !== DZEN1045_PHASE_B_DIALOG_PROBE.recordedAt
        || args.expectedProviderId !== DZEN1045_PHASE_B_RECONCILE.providerId
        || args.idempotencyKey !== DZEN1045_PHASE_B_DIALOG_PROBE.idempotencyKey) {
        throw new Error('[DZEN1045_PHASE_B_DIALOG_PROBE_SCOPE_MISMATCH]');
    }
    const userId = Number(actor[1]);
    const [member, manifest, task] = await Promise.all([
        prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        loadAgentWorkspaceManifest(10, userId),
        prisma.contentItem.findFirst({ where: { id: 1045, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } })
    ]);
    if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== DZEN1045_RECOVERY_MANIFEST) throw new Error('[STALE_MANIFEST]');
    const delivery = object(object(task?.quality_report).publication_task_delivery);
    const evidence = object(delivery.phase_b_reconcile_evidence);
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.status !== 'publishing' || task.publication_mode !== 'owner_released'
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.selected_asset_id !== 129 || checksum(task) !== DZEN1045.assetSha
        || task.publication_fact || task.published_link || delivery.state !== 'phase_b_final_not_attempted'
        || delivery.final_submit_count !== 0 || delivery.final_submit_may_have_occurred !== false
        || delivery.final_submit_allowed !== false || evidence.classification !== 'NOT_ATTEMPTED_FINAL'
        || evidence.verified_at !== DZEN1045_PHASE_B_DIALOG_PROBE.recordedAt) {
        throw new Error('[DZEN1045_PHASE_B_DIALOG_PROBE_TASK_MISMATCH]');
    }
    const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
    if (!config.cookies || String(config.channel_id || '') !== DZEN1045.publisherId) {
        throw new Error('[DZEN1045_PHASE_B_DIALOG_PROBE_CONNECTOR_NOT_READY]');
    }
    return { task_id: 1045, source: { reconcile_key: DZEN1045_PHASE_B_DIALOG_PROBE.sourceReconcileKey,
        recorded_at: DZEN1045_PHASE_B_DIALOG_PROBE.recordedAt,
        provider_id: DZEN1045_PHASE_B_RECONCILE.providerId },
    probe: await dzenService.probeTask1045PhaseBDialog(config, task.draft_text || '') };
}
