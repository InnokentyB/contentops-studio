import { createHash } from 'node:crypto';
import prisma from '../db';
import dzenService from './dzen.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RECOVERY_MANIFEST } from './dzen_task1045_new_draft_recovery.service';
import { assertDzen1045PhaseAProbeIncident, DZEN1045_PHASE_A_PROBE } from './dzen_task1045_phase_a_probe_contract';

export type Dzen1045PhaseAProbeArgs = { projectId: 10; taskId: 1045; actorId: string;
    expectedManifestChecksum: typeof DZEN1045_RECOVERY_MANIFEST;
    expectedPhaseAIdempotencyKey: typeof DZEN1045_PHASE_A_PROBE.phaseAKey;
    expectedFailedAt: typeof DZEN1045_PHASE_A_PROBE.failedAt };
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
export async function probeDzenTask1045PhaseACreationContract(args: Dzen1045PhaseAProbeArgs) {
    const config = await loadDzenTask1045ProbeConfig(args);
    return { task_id: 1045, incident: { phase_a_key: DZEN1045_PHASE_A_PROBE.phaseAKey,
        failed_at: DZEN1045_PHASE_A_PROBE.failedAt },
    probe: await dzenService.probeTask1045CreationContract(config) };
}
export async function probeDzenTask1045PhaseACreationMenu(args: Dzen1045PhaseAProbeArgs) {
    const config = await loadDzenTask1045ProbeConfig(args);
    return { task_id: 1045, incident: { phase_a_key: DZEN1045_PHASE_A_PROBE.phaseAKey,
        failed_at: DZEN1045_PHASE_A_PROBE.failedAt },
    probe: await dzenService.probeTask1045CreationMenu(config) };
}
async function loadDzenTask1045ProbeConfig(args: Dzen1045PhaseAProbeArgs) {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1045
        || args.expectedManifestChecksum !== DZEN1045_RECOVERY_MANIFEST
        || args.expectedPhaseAIdempotencyKey !== DZEN1045_PHASE_A_PROBE.phaseAKey
        || args.expectedFailedAt !== DZEN1045_PHASE_A_PROBE.failedAt) {
        throw new Error('[DZEN1045_PHASE_A_PROBE_SCOPE_MISMATCH]');
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
    assertDzen1045PhaseAProbeIncident(delivery);
    const provenance = object(task?.selected_asset?.provenance);
    const checksum = String(object(provenance.planner_storage).sha256 || provenance.sha256 || '');
    if (!task || task.channel_id !== 116 || task.channel?.type !== 'dzen' || !task.channel.is_active
        || task.content_revision !== 4 || task.accepted_revision !== 4 || task.text_state !== 'accepted'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== DZEN1045.bodySha
        || task.selected_asset_id !== 129 || checksum !== DZEN1045.assetSha
        || task.publication_fact || task.published_link) throw new Error('[DZEN1045_PHASE_A_PROBE_TASK_MISMATCH]');
    const config = resolveEffectiveChannelConfig('dzen', task.channel.config || {});
    return config;
}
