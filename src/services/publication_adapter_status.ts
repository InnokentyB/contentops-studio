import { hasOwnedPublicationHistory } from './publication_owned_guard';
import prisma from '../db';
import { requireProjectActorAccess } from './project_access.service';
import { VkConnectorDispatchService } from './vk_connector_dispatch.service';
import { vkConnectorRepository } from './vk_connector_repository';
import { VK_CONNECTOR_HOST, VK_CONNECTOR_SCOPE } from './vk_connector_contract';
import type { AdapterStatusReader } from '../routes/api/publication_adapter_status';

const service = new VkConnectorDispatchService(vkConnectorRepository, process.env.VK_CONNECTOR_DISPATCH_ENABLED === '1');
export const readPublicationAdapterStatus: AdapterStatusReader = async identity => {
    await requireProjectActorAccess(identity.projectId, identity.actorId);
    const task = await prisma.contentItem.findFirst({ where: { id: identity.taskId, project_id: identity.projectId },
        select: { channel_id: true, publication_fact: { select: { outcome: true, public_url: true } }, channel: { select: { type: true } } } });
    if (!task) return null;
    const observedAt = new Date().toISOString();
    const base = { canExecute: false as const, observedAt, heartbeatAt: null, publicUrl: null };
    if (await hasOwnedPublicationHistory(prisma, identity)) {
        const confirmed = task.publication_fact?.outcome === 'published' && Boolean(task.publication_fact.public_url);
        return { ...base, supported: true, manualRecordAllowed: false,
            state: confirmed ? 'confirmed' : 'verification_required',
            blocker: confirmed ? null : 'OWNED_ADAPTER_READINESS_UNVERIFIED', connection: 'unavailable',
            publicUrl: confirmed ? task.publication_fact!.public_url : null };
    }
    if (identity.projectId !== VK_CONNECTOR_SCOPE.projectId || identity.taskId !== VK_CONNECTOR_SCOPE.taskId
        || task.channel_id !== VK_CONNECTOR_SCOPE.channelId || task.channel?.type.trim().toLowerCase() !== 'vk')
        return { ...base, supported: false, manualRecordAllowed: true, state: 'unsupported',
            blocker: 'ADAPTER_NOT_CONFIGURED', connection: 'unavailable' };
    const row = await prisma.connectorDispatchJob.findFirst({
        where: { project_id: identity.projectId, content_item_id: identity.taskId, channel_id: task.channel_id },
        orderBy: { created_at: 'desc' }, select: { id: true } });
    if (!row) return { ...base, supported: true, manualRecordAllowed: true, state: 'not_queued',
        blocker: 'ADAPTER_JOB_NOT_FOUND', connection: 'unavailable' };
    const [job, health] = await Promise.all([
        service.status({ ...identity, jobId: row.id }), service.health({ ...identity, hostId: VK_CONNECTOR_HOST })
    ]);
    return { ...base, supported: true, admissionReason: 'ACTION_TIME_ADMISSION_UNAVAILABLE',
        manualRecordAllowed: job.state === 'confirmed' || (job.state === 'cancelled' && job.attemptId === null),
        state: job.state, blocker: job.blocker, connection: health.status,
        heartbeatAt: health.heartbeatAt, publicUrl: job.publicUrl };
};
