import { legacyProviderJobWhere } from './publication_provider_queue';
import { Prisma, type ConnectorDispatchJob, type ConnectorHostStatus } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { buildVkConnectorSnapshot } from './vk_connector_package';
import { requireProjectAccess, requireProjectOwner } from './work_queue/auth';
import { type ConnectorJob, type ConnectorHost,
    type ConnectorRepository, type ConnectorStore, type ConnectorState, ConnectorBindingSchema, connectorHash, connectorPackageHash, connectorSecretEqual } from './vk_connector_contract';

export { ConnectorBindingSchema } from './vk_connector_contract';
const states = z.enum(['queued', 'accepted', 'blocked', 'verification_required', 'confirmed', 'reconciling', 'ready', 'executing', 'cancelled']);
function invalid(): never { throw new Error('[VK_CONNECTOR_PACKAGE_NOT_READY]'); }
function toJob(row: ConnectorDispatchJob): ConnectorJob {
    const binding = ConnectorBindingSchema.safeParse(row.binding), state = states.safeParse(row.state);
    if (!binding.success || !state.success || binding.data.projectId !== row.project_id
        || binding.data.taskId !== row.content_item_id || binding.data.channelId !== row.channel_id
        || binding.data.revision !== row.content_revision || binding.data.selectedAssetId !== row.selected_asset_id
        || connectorPackageHash(binding.data) !== row.package_sha256) invalid();
    return { jobId: row.id, projectId: row.project_id, taskId: row.content_item_id,
        channelId: row.channel_id, workItemId: row.work_item_id, package: binding.data,
        packageSha256: row.package_sha256, idempotencyKey: row.idempotency_key, state: state.data,
        hostId: row.host_id, instanceId: row.consumer_instance_id, generation: row.generation,
        receiptAt: row.receipt_at, updatedAt: row.updated_at, blocker: row.blocker_code,
        attemptId: row.attempt_id, factId: row.publication_fact_id, canonicalLeaseSha256: row.canonical_lease_sha256,
        canonicalLeaseExpiresAt: row.canonical_lease_expires_at };
}
function toHost(row: ConnectorHostStatus): ConnectorHost {
    if (row.mode !== 'infrastructure_only' && row.mode !== 'vk_feed_provider') throw new Error('[VK_CONNECTOR_HOST_MODE_INVALID]');
    return { projectId: row.project_id, hostId: row.host_id, instanceId: row.instance_id,
        buildVersion: row.build_version, heartbeatAt: row.heartbeat_at,
        mode: row.mode, blocker: row.blocker_code };
}
function storeFor(tx: Prisma.TransactionClient): ConnectorStore {
    return {
        authorize: async (p, actor, mutation) => {
            if (mutation) await requireProjectOwner(tx, p, actor);
            else await requireProjectAccess(tx, p, actor, 'work_queue:read');
        },
        bindLease: async (p, actor, token, expires, binding) => {
            const row = await tx.workItem.findFirst({ where: { id: binding.workItemId, project_id: p, content_item_id: binding.taskId },
                select: { state: true, lease_token: true, lease_actor_id: true, lease_expires_at: true, updated_at: true } });
            if (!row || row.state !== 'claimed' || row.lease_actor_id !== actor || !row.lease_token || !connectorSecretEqual(row.lease_token, token)
                || !row.lease_expires_at || row.lease_expires_at.getTime() <= Date.now()
                || row.lease_expires_at.toISOString() !== expires) throw new Error('[VK_CONNECTOR_FENCED]');
            if ((await tx.workItem.updateMany({ where: { id: binding.workItemId, project_id: p, content_item_id: binding.taskId, updated_at: row.updated_at,
                lease_actor_id: actor, lease_token: token }, data: { updated_at: row.updated_at } })).count !== 1) throw new Error('[VK_CONNECTOR_CAS_CONFLICT]');
        },
        commandResult: async (p, actor, command, key) => (await tx.workflowEvent.findFirst({ where: {
            project_id: p, actor_id: actor, command, idempotency_key: key }, select: { after_state: true } }))?.after_state,
        executionPackage: async (p, id) => {
            const task = await tx.contentItem.findFirst({ where: { project_id: p, id },
                select: { draft_text: true, selected_asset: { select: { file_url: true } }, quality_report: true } });
            const snapshot = await storeFor(tx).snapshot(p, id);
            if (!task || connectorHash(task.draft_text?.trim() || '') !== snapshot.package.bodySha256) invalid();
            const release = z.object({ owner_release: z.object({ approval_reference: z.string().min(10),
                released_at: z.iso.datetime() }) }).parse(task.quality_report).owner_release;
            const url = z.url().parse(task.selected_asset?.file_url);
            if (new URL(url).protocol !== 'https:' || new URL(url).username || new URL(url).password) invalid();
            return { binding: snapshot.package, packageSha256: connectorPackageHash(snapshot.package),
                body: task.draft_text?.trim() || '', asset: { id: snapshot.package.selectedAssetId, url, sha256: snapshot.package.assetSha256 },
                approvalReference: release.approval_reference, releasedAt: release.released_at, workItemId: snapshot.workItemId,
                permissionStatus: 'NOT_CHECKED', providerExecution: 'blocked' };
        },
        snapshot: async (p, id) => {
            const task = await tx.contentItem.findFirst({ where: { project_id: p, id },
                include: { channel: true, selected_asset: true, publication_fact: true } });
            if (!task) invalid();
            const items = await tx.workItem.findMany({ where: { project_id: p, content_item_id: id,
                input_context_version: task.content_revision, kind: 'browser_publish', assignee_role: 'browser_publisher' },
                orderBy: { id: 'desc' }, take: 2 });
            if (items.length !== 1) invalid();
            const item = items[0];
            const attempt = await tx.deliveryAttempt.findFirst({ where: { project_id: p, content_item_id: id }, orderBy: { id: 'desc' } });
            return buildVkConnectorSnapshot(task, item, attempt);
        },
        job: async (p, id) => { const r = await tx.connectorDispatchJob.findFirst({ where: { project_id: p, id, ...legacyProviderJobWhere('vk') } }); return r ? toJob(r) : null; },
        jobByKey: async (p, key) => {
            const r = await tx.connectorDispatchJob.findFirst({ where: { project_id: p, idempotency_key: key, ...legacyProviderJobWhere('vk') } });
            if (r) return toJob(r);
            const collision = await tx.connectorDispatchJob.findUnique({ where: { project_id_idempotency_key: { project_id: p, idempotency_key: key } }, select: { id: true } });
            if (collision) throw new Error('[PROVIDER_IDEMPOTENCY_CONFLICT]');
            return null;
        },
        jobByPackage: async (p, hash) => { const r = await tx.connectorDispatchJob.findFirst({ where: { project_id: p, package_sha256: hash, ...legacyProviderJobWhere('vk') } }); return r ? toJob(r) : null; },
        insertJob: async j => { await tx.connectorDispatchJob.create({ data: {
            id: j.jobId, project_id: j.projectId, content_item_id: j.taskId, channel_id: j.channelId,
            work_item_id: j.workItemId, content_revision: j.package.revision, selected_asset_id: j.package.selectedAssetId,
            package_sha256: j.packageSha256, binding: { ...j.package }, idempotency_key: j.idempotencyKey,
            state: j.state, generation: j.generation, updated_at: j.updatedAt } }); },
        updateJob: async (id, generation, state: ConnectorState, patch) => {
            const result = await tx.connectorDispatchJob.updateMany({ where: { id, generation, state, ...legacyProviderJobWhere('vk') }, data: {
                state: patch.state, host_id: patch.hostId, consumer_instance_id: patch.instanceId,
                generation: patch.generation, canonical_lease_sha256: patch.canonicalLeaseSha256,
                canonical_lease_expires_at: patch.canonicalLeaseExpiresAt, receipt_at: patch.receiptAt, blocker_code: patch.blocker,
                attempt_id: patch.attemptId, publication_fact_id: patch.factId, updated_at: patch.updatedAt } });
            return result.count === 1;
        },
        candidates: async p => (await tx.connectorDispatchJob.findMany({ where: { project_id: p, ...legacyProviderJobWhere('vk'),
            state: { in: ['queued', 'accepted', 'reconciling', 'ready', 'executing'] } }, orderBy: { created_at: 'asc' }, take: 10 })).map(toJob),
        host: async (p, id) => { const r = await tx.connectorHostStatus.findUnique({ where: { project_id_host_id: { project_id: p, host_id: id } } }); return r ? toHost(r) : null; },
        saveHost: async h => {
            const data = { instance_id: h.instanceId, build_version: h.buildVersion, heartbeat_at: h.heartbeatAt,
                mode: h.mode, blocker_code: h.blocker };
            await tx.connectorHostStatus.upsert({ where: { project_id_host_id: { project_id: h.projectId, host_id: h.hostId } },
                create: { project_id: h.projectId, host_id: h.hostId, ...data }, update: data });
        },
        event: async (p, task, actor, command, data) => { await tx.workflowEvent.create({ data: {
            project_id: p, content_item_id: task, actor_id: actor, command, idempotency_key: data.idempotencyKey, after_state: { ...data } } }); }
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
