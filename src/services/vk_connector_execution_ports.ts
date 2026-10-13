import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import publicationFactService, { type RecordPublicationFactArgs } from './publication_fact.service';
import { requireProjectOwner } from './work_queue/auth';
import { claimVkBrowserPublication } from './vk_browser_owner_release.service';
import { startVkBrowserSubmission, confirmVkBrowserSubmission } from './vk_browser_submission_control.service';
import { connectorHash, connectorPackageHash, connectorSecretEqual, type ConnectorExecutionPackage } from './vk_connector_contract';
import { buildVkConnectorSnapshot } from './vk_connector_package';
import type { ConnectorExecutionIdentity, ConnectorStartArgs, ConnectorConfirmArgs, ConnectorUncertainArgs,
    VkConnectorExecutionPorts } from './vk_connector_execution_contract';
function fail(code: string): never { throw new Error(`[VK_CONNECTOR_${code}]`); }

/** Locks transport/current payload rows in the same transaction as the canonical mutation. */
export async function assertVkConnectorTransactionFence(tx: Prisma.TransactionClient,
    args: ConnectorExecutionIdentity & { leaseToken?: string; attemptId?: number }, requireLease: boolean): Promise<void> {
    await requireProjectOwner(tx, args.projectId, args.actorId);
    if (args.projectId !== 10) fail('SCOPE_MISMATCH');
    const job = await tx.connectorDispatchJob.findFirst({ where: { project_id: 10, id: args.jobId } });
    const host = await tx.connectorHostStatus.findUnique({ where: { project_id_host_id: { project_id: 10, host_id: args.hostId } } });
    if (!job || job.content_item_id !== 1048 || job.channel_id !== 117 || job.work_item_id !== 1699
        || (args.attemptId !== undefined && job.attempt_id !== args.attemptId)
        || job.generation !== args.generation || job.package_sha256 !== args.packageSha256
        || job.host_id !== args.hostId || job.consumer_instance_id !== args.instanceId
        || !host || host.mode !== 'vk_feed_provider' || host.instance_id !== args.instanceId || Date.now() - host.heartbeat_at.getTime() > 30_000
        || !(requireLease ? ['ready','executing'] : ['accepted','reconciling','ready','executing','verification_required']).includes(job.state)) fail('FENCED');
    const task = await tx.contentItem.findFirst({ where: { project_id: 10, id: 1048 },
        include: { channel: true, selected_asset: true, publication_fact: true } });
    const work = await tx.workItem.findFirst({ where: { project_id: 10, id: 1699, content_item_id: 1048 } });
    const attempt = await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1048 }, orderBy: { id: 'desc' } });
    const snapshot = buildVkConnectorSnapshot(task, work, attempt);
    if (!task || !work || !task.selected_asset || !task.channel
        || connectorPackageHash(snapshot.package) !== args.packageSha256
        || !['browser_required','publishing'].includes(task.status) || task.handoff_state !== 'ready'
        || task.publication_mode !== 'browser_required' || !task.channel.is_active
        || (task.quality_report && typeof task.quality_report === 'object' && !Array.isArray(task.quality_report)
            && 'publication_hold' in task.quality_report && task.quality_report.publication_hold)
        || task.publication_fact || task.published_link) fail('PACKAGE_CHANGED');
    if (requireLease && (!args.leaseToken || work.state !== 'claimed' || !work.lease_token || !connectorSecretEqual(work.lease_token, args.leaseToken)
        || work.lease_actor_id !== args.actorId || !work.lease_expires_at || work.lease_expires_at.getTime() <= Date.now()
        || !job.canonical_lease_sha256 || !connectorSecretEqual(job.canonical_lease_sha256, connectorHash(args.leaseToken))
        || !job.canonical_lease_expires_at || job.canonical_lease_expires_at.getTime() <= Date.now())) fail('FENCED');
    const rows = [
        await tx.connectorDispatchJob.updateMany({ where: { id: job.id, project_id: 10, generation: args.generation,
            state: job.state, package_sha256: args.packageSha256, updated_at: job.updated_at }, data: { updated_at: job.updated_at } }),
        await tx.contentItem.updateMany({ where: { id: 1048, project_id: 10, updated_at: task.updated_at,
            content_revision: 1, accepted_revision: 1, selected_asset_id: 130, status: task.status }, data: { updated_at: task.updated_at } }),
        await tx.workItem.updateMany({ where: { id: 1699, project_id: 10, updated_at: work.updated_at }, data: { updated_at: work.updated_at } }),
        await tx.imageAsset.updateMany({ where: { id: 130, project_id: 10, status: 'approved', updated_at: task.selected_asset.updated_at }, data: { updated_at: task.selected_asset.updated_at } }),
        await tx.socialChannel.updateMany({ where: { id: 117, project_id: 10, is_active: true, updated_at: task.channel.updated_at }, data: { updated_at: task.channel.updated_at } })
    ];
    if (rows.some(row => row.count !== 1)) fail('CAS_CONFLICT');
}
async function canonicalLease(args: ConnectorExecutionIdentity & { leaseToken: string }): Promise<void> {
    await prisma.$transaction(tx => assertVkConnectorTransactionFence(tx, args, true), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
async function start(args: ConnectorStartArgs) {
    return prisma.$transaction(async tx => {
        await assertVkConnectorTransactionFence(tx, args, true);
        if (await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1048 }, select: { id: true } })) fail('VERIFICATION_REQUIRED');
        return startVkBrowserSubmission({ transaction: async callback => callback(tx), now: () => new Date(),
            hashBody: (body: string) => connectorHash(body.trim()), recordFact: async () => fail('FACT_PATH_INVALID') }, args);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
async function confirm(args: ConnectorConfirmArgs) {
    let first = true;
    return confirmVkBrowserSubmission({ transaction: async callback => prisma.$transaction(async tx => {
        if (first) { await assertVkConnectorTransactionFence(tx, args, true); first = false; }
        else {
            const row = await tx.connectorDispatchJob.findFirst({ where: { id: args.jobId, project_id: 10,
                generation: args.generation, package_sha256: args.packageSha256 } });
            if (!row || (await tx.connectorDispatchJob.updateMany({ where: { id: row.id, generation: args.generation,
                project_id: 10, package_sha256: args.packageSha256, updated_at: row.updated_at },
                data: { updated_at: row.updated_at } })).count !== 1) fail('FENCED');
        }
        return callback(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), now: () => new Date(), hashBody: (body: string) => connectorHash(body.trim()),
    recordFact: (record: RecordPublicationFactArgs) => publicationFactService.record({ ...record,
        beforeWrite: tx => assertVkConnectorTransactionFence(tx, args, true) }) }, args);
}
async function uncertain(args: ConnectorUncertainArgs) {
    return prisma.$transaction(async tx => {
        await requireProjectOwner(tx, 10, args.actorId);
        const job = await tx.connectorDispatchJob.findFirst({ where: { id: args.jobId, project_id: 10,
            generation: args.generation, package_sha256: args.packageSha256, attempt_id: args.attemptId,
            host_id: args.hostId, consumer_instance_id: args.instanceId } });
        if (!job) fail('FENCED');
        const changed = await tx.deliveryAttempt.updateMany({ where: { id: args.attemptId, project_id: 10,
            content_item_id: 1048, channel_id: 117, idempotency_key: args.idempotencyKey, status: 'pending' },
            data: { requires_manual_confirmation: true, error_message: '[VK_CONNECTOR_PROVIDER_VERIFICATION_REQUIRED]' } });
        if (changed.count !== 1) fail('VERIFICATION_REQUIRED');
        if ((await tx.connectorDispatchJob.updateMany({ where: { id: args.jobId, project_id: 10, generation: args.generation,
            package_sha256: args.packageSha256, state: job.state, host_id: args.hostId, consumer_instance_id: args.instanceId },
            data: { state: 'verification_required', blocker_code: 'PROVIDER_VERIFICATION_REQUIRED' } })).count !== 1) fail('FENCED');
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1048, actor_id: args.actorId,
            command: 'vk_connector_submission_uncertain', after_state: { job_id: args.jobId, generation: args.generation, attempt_id: args.attemptId } } });
        return { status: 'verification_required', attempt_id: args.attemptId, retry_allowed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
/** Canonical operations are implemented; permission and evidence capability remain unavailable by default. */
export function createVkConnectorExecutionPorts(authority?: Pick<VkConnectorExecutionPorts,
    'admission' | 'verifyEvidence' | 'verifyMediaAcknowledgement'>): VkConnectorExecutionPorts {
    return { admission: authority?.admission || (async () => 'NOT_CHECKED'),
        verifyEvidence: authority?.verifyEvidence || (async () => null),
        verifyMediaAcknowledgement: authority?.verifyMediaAcknowledgement || (async () => false),
        claimLease: async args => {
            const raw = await claimVkBrowserPublication({ ...args, leaseSeconds: 1800 });
            const parsed = z.object({ lease_token: z.string().min(1), lease_expires_at: z.iso.datetime() }).safeParse(raw);
            if (!parsed.success) fail('LEASE_UNAVAILABLE');
            return { leaseToken: parsed.data.lease_token, leaseExpiresAt: parsed.data.lease_expires_at };
        }, checkLease: canonicalLease, start, confirm, uncertain,
        recordMatchedFact: async (args, execution: ConnectorExecutionPackage, post) => {
            if (!/^-240051152_[1-9]\d*$/.test(post.objectId)) fail('OBJECT_UNCONFIRMED');
            const publicUrl = `https://vk.com/wall${post.objectId}`;
            const fact = await publicationFactService.record({ projectId: 10, taskId: 1048, actorId: args.actorId,
                artifactKind: 'post', outcome: 'published', publishedAt: post.publishedAt,
                publicUrl, providerObjectId: post.objectId, confirmationMode: 'reconciled',
                evidence: { type: 'provider_id', ref: post.objectId }, utmStatus: 'not_applicable',
                note: `Existing exact provider wall object reconciled without a new delivery attempt. Evidence sha256:${connectorHash(JSON.stringify(post))}`,
                beforeWrite: async tx => {
                    await assertVkConnectorTransactionFence(tx, args, false);
                    if (connectorPackageHash(execution.binding) !== args.packageSha256) fail('PACKAGE_CHANGED');
                } });
            return { factId: fact.publication_fact.id, publicUrl };
        } };
}
