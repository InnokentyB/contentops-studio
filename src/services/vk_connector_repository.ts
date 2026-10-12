import { Prisma, type ConnectorDispatchJob, type ConnectorHostStatus } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { buildVkConnectorSnapshot } from './vk_connector_package';
import { requireProjectAccess, requireProjectOwner } from './work_queue/auth';
import { type ConnectorJob, type ConnectorHost,
    type ConnectorRepository, type ConnectorStore, type ConnectorState } from './vk_connector_contract';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const ConnectorBindingSchema = z.object({ projectId: z.literal(10), taskId: z.literal(1048),
    channelId: z.literal(117), communityId: z.literal(-240051152), revision: z.literal(1),
    selectedAssetId: z.literal(130), placement: z.literal('feed'), bodySha256: hex,
    assetSha256: hex, releaseSha256: hex }).strict();
const states = z.enum(['queued', 'accepted', 'blocked', 'verification_required', 'confirmed']);
function invalid(): never { throw new Error('[VK_CONNECTOR_PACKAGE_NOT_READY]'); }
function toJob(row: ConnectorDispatchJob): ConnectorJob {
    const binding = ConnectorBindingSchema.safeParse(row.binding), state = states.safeParse(row.state);
    if (!binding.success || !state.success) invalid();
    return { jobId: row.id, projectId: row.project_id, taskId: row.content_item_id,
        channelId: row.channel_id, workItemId: row.work_item_id, package: binding.data,
        packageSha256: row.package_sha256, idempotencyKey: row.idempotency_key, state: state.data,
        hostId: row.host_id, instanceId: row.consumer_instance_id, generation: row.generation,
        receiptAt: row.receipt_at, updatedAt: row.updated_at, blocker: row.blocker_code,
        attemptId: row.attempt_id, factId: row.publication_fact_id };
}
function toHost(row: ConnectorHostStatus): ConnectorHost {
    if (row.mode !== 'infrastructure_only') throw new Error('[VK_CONNECTOR_HOST_MODE_INVALID]');
    return { projectId: row.project_id, hostId: row.host_id, instanceId: row.instance_id,
        buildVersion: row.build_version, heartbeatAt: row.heartbeat_at,
        mode: 'infrastructure_only', blocker: row.blocker_code };
}
function storeFor(tx: Prisma.TransactionClient): ConnectorStore {
    return {
        authorize: async (p, actor, mutation) => {
            if (mutation) await requireProjectOwner(tx, p, actor);
            else await requireProjectAccess(tx, p, actor, 'work_queue:read');
        },
        snapshot: async (p, id) => {
            if (p !== 10 || id !== 1048) invalid();
            const task = await tx.contentItem.findFirst({ where: { project_id: p, id },
                include: { channel: true, selected_asset: true, publication_fact: true } });
            const item = await tx.workItem.findFirst({ where: { project_id: p, content_item_id: id,
                id: 1699, kind: 'browser_publish', assignee_role: 'browser_publisher' } });
            const attempt = await tx.deliveryAttempt.findFirst({ where: { project_id: p, content_item_id: id }, orderBy: { id: 'desc' } });
            return buildVkConnectorSnapshot(task, item, attempt);
        },
        job: async (p, id) => { const r = await tx.connectorDispatchJob.findFirst({ where: { project_id: p, id } }); return r ? toJob(r) : null; },
        jobByKey: async (p, key) => { const r = await tx.connectorDispatchJob.findUnique({ where: { project_id_idempotency_key: { project_id: p, idempotency_key: key } } }); return r ? toJob(r) : null; },
        jobByPackage: async (p, hash) => { const r = await tx.connectorDispatchJob.findFirst({ where: { project_id: p, package_sha256: hash } }); return r ? toJob(r) : null; },
        insertJob: async j => { await tx.connectorDispatchJob.create({ data: {
            id: j.jobId, project_id: j.projectId, content_item_id: j.taskId, channel_id: j.channelId,
            work_item_id: j.workItemId, content_revision: j.package.revision, selected_asset_id: j.package.selectedAssetId,
            package_sha256: j.packageSha256, binding: { ...j.package }, idempotency_key: j.idempotencyKey,
            state: j.state, generation: j.generation, updated_at: j.updatedAt } }); },
        updateJob: async (id, generation, state: ConnectorState, patch) => {
            const result = await tx.connectorDispatchJob.updateMany({ where: { id, generation, state }, data: {
                state: patch.state, host_id: patch.hostId, consumer_instance_id: patch.instanceId,
                generation: patch.generation, receipt_at: patch.receiptAt, blocker_code: patch.blocker,
                attempt_id: patch.attemptId, publication_fact_id: patch.factId, updated_at: patch.updatedAt } });
            return result.count === 1;
        },
        candidates: async p => (await tx.connectorDispatchJob.findMany({ where: { project_id: p,
            state: { in: ['queued', 'accepted'] } }, orderBy: { created_at: 'asc' }, take: 10 })).map(toJob),
        host: async (p, id) => { const r = await tx.connectorHostStatus.findUnique({ where: { project_id_host_id: { project_id: p, host_id: id } } }); return r ? toHost(r) : null; },
        saveHost: async h => {
            const data = { instance_id: h.instanceId, build_version: h.buildVersion, heartbeat_at: h.heartbeatAt,
                mode: h.mode, blocker_code: h.blocker };
            await tx.connectorHostStatus.upsert({ where: { project_id_host_id: { project_id: h.projectId, host_id: h.hostId } },
                create: { project_id: h.projectId, host_id: h.hostId, ...data }, update: data });
        },
        event: async (p, task, actor, command, data) => { await tx.workflowEvent.create({ data: {
            project_id: p, content_item_id: task, actor_id: actor, command, after_state: { ...data } } }); }
    };
}
export const vkConnectorRepository: ConnectorRepository = {
    async transaction(run) {
        for (let retry = 0; ; retry++) {
            try { return await prisma.$transaction(tx => run(storeFor(tx)), {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 }); }
            catch (error) {
                const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code);
                if (!retryable || retry >= 2) throw error;
            }
        }
    }
};
