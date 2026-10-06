import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import publicationAdapterService from './publication_adapter.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import workQueueService from './work_queue.service';

export type VkBrowserReleaseArgs = {
    projectId: number;
    taskId: number;
    actorId: string;
    expectedChannelId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number;
    expectedBodySha256: string;
    expectedSelectedAssetId: number;
    expectedAssetSha256: string;
    expectedScheduleAt: string;
    expectedManifestChecksum: string;
    approvalReference: string;
    idempotencyKey: string;
};

export type VkBrowserReleaseDependencies = {
    transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
    getManifestChecksum(projectId: number, actorId: string): Promise<string>;
    hashBody(body: string): string;
};

function assetSha256(task: any) {
    const provenance = task?.selected_asset?.provenance;
    const storage = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
        ? (provenance as Record<string, any>).planner_storage
        : null;
    return typeof storage?.sha256 === 'string'
        ? storage.sha256
        : typeof provenance?.sha256 === 'string' ? provenance.sha256 : null;
}

function requestHash(args: VkBrowserReleaseArgs) {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

export async function releaseVkBrowserTask(dependencies: VkBrowserReleaseDependencies, args: VkBrowserReleaseArgs) {
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    if (!/^sha256:[a-f0-9]{64}$/i.test(args.expectedManifestChecksum)) throw new Error('[INVALID_MANIFEST_CHECKSUM]');
    const expectedSchedule = new Date(args.expectedScheduleAt);
    if (!Number.isFinite(expectedSchedule.getTime())) throw new Error('[INVALID_SCHEDULE]');
    const userMatch = /^user:(\d+)$/.exec(args.actorId);
    if (!userMatch) throw new Error('[OWNER_REQUIRED]');
    const hash = requestHash(args);

    return dependencies.transaction(async (tx) => {
        const membership = await tx.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: args.projectId, user_id: Number(userMatch[1]) }
        } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const manifestChecksum = await dependencies.getManifestChecksum(args.projectId, args.actorId);
        if (manifestChecksum !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
        const command = 'ba_release_approved_vk_browser_task';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId,
            actor_id: args.actorId,
            command,
            idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if (prior.before_state?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...prior.after_state, replayed: true };
        }

        const task = await tx.contentItem.findFirst({
            where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        const config = task?.channel ? resolveEffectiveChannelConfig('vk', task.channel.config || {}) : {};
        const browserAssisted = task?.channel?.type === 'vk'
            && !publicationAdapterService.supportsDirectExecution({
                ...config,
                ...((config.raw_account as Record<string, unknown> | undefined) || {}),
                platform: 'vk'
            });
        const bodyHash = dependencies.hashBody(task?.draft_text || '');
        if (!task
            || task.channel_id !== args.expectedChannelId
            || !browserAssisted
            || task.status !== 'ready_for_execution'
            || task.handoff_state !== 'ready'
            || task.publication_mode !== 'approval_required'
            || task.content_revision !== args.expectedContentRevision
            || task.accepted_revision !== args.expectedAcceptedRevision
            || task.content_revision !== task.accepted_revision
            || task.text_state !== 'accepted'
            || task.visual_state !== 'APPROVED'
            || task.visual_placement !== 'feed'
            || task.selected_asset_id !== args.expectedSelectedAssetId
            || task.selected_asset?.status !== 'approved'
            || task.selected_asset?.content_revision !== args.expectedContentRevision
            || !task.selected_asset?.file_url
            || assetSha256(task) !== args.expectedAssetSha256
            || task.schedule_at?.toISOString() !== args.expectedScheduleAt
            || bodyHash !== args.expectedBodySha256
            || task.publication_fact
            || task.published_link) {
            throw new Error('[OWNER_RELEASE_GUARD_FAILED] Exact accepted VK browser task is required');
        }
        if (await tx.deliveryAttempt.findFirst({ where: {
            project_id: args.projectId,
            content_item_id: args.taskId
        } })) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        if (await tx.workItem.findFirst({ where: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            kind: 'browser_publish',
            state: { notIn: ['completed', 'cancelled'] }
        } })) throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');

        const checksumBeforeCas = await dependencies.getManifestChecksum(args.projectId, args.actorId);
        if (checksumBeforeCas !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
        const changed = await tx.contentItem.updateMany({
            where: {
                id: args.taskId,
                project_id: args.projectId,
                channel_id: args.expectedChannelId,
                status: 'ready_for_execution',
                handoff_state: 'ready',
                publication_mode: 'approval_required',
                content_revision: args.expectedContentRevision,
                accepted_revision: args.expectedAcceptedRevision,
                text_state: 'accepted',
                visual_state: 'APPROVED',
                visual_placement: 'feed',
                selected_asset_id: args.expectedSelectedAssetId,
                schedule_at: expectedSchedule
            },
            data: {
                status: 'browser_required',
                publication_mode: 'browser_required',
                quality_report: {
                    ...((task.quality_report as Record<string, unknown> | null) || {}),
                    publication_route: 'browser_required',
                    owner_release: {
                        publication_authorized: true,
                        actor_id: args.actorId,
                        approval_reference: args.approvalReference,
                        content_revision: args.expectedContentRevision,
                        body_sha256: bodyHash,
                        selected_asset_id: args.expectedSelectedAssetId,
                        asset_sha256: args.expectedAssetSha256,
                        released_at: new Date().toISOString()
                    }
                }
            }
        });
        if (changed.count !== 1) throw new Error('[OWNER_RELEASE_CAS_CONFLICT]');
        const workItem = await tx.workItem.create({ data: {
            project_id: args.projectId,
            week_package_id: task.week_package_id,
            content_item_id: args.taskId,
            item_key: task.item_key || `publication-${args.taskId}`,
            kind: 'browser_publish',
            state: 'available',
            assignee_role: 'browser_publisher',
            due_at: task.schedule_at || task.publish_at || new Date(),
            reason_code: 'OWNER_RELEASED_BROWSER_PUBLICATION',
            note: 'Owner released the exact accepted VK revision for one browser publication.',
            result_payload: {
                publication_authorized: true,
                approval_reference: args.approvalReference,
                content_revision: args.expectedContentRevision,
                body_sha256: bodyHash,
                selected_asset_id: args.expectedSelectedAssetId,
                asset_sha256: args.expectedAssetSha256,
                channel_id: args.expectedChannelId
            },
            input_context_version: args.expectedContentRevision,
            dedupe_key: `browser_publish:${args.taskId}:r${args.expectedContentRevision}`
        } });
        const result = {
            project_id: args.projectId,
            task_id: args.taskId,
            channel_id: args.expectedChannelId,
            content_revision: args.expectedContentRevision,
            accepted_revision: args.expectedAcceptedRevision,
            body_sha256: bodyHash,
            selected_asset_id: args.expectedSelectedAssetId,
            asset_sha256: args.expectedAssetSha256,
            schedule_at: args.expectedScheduleAt,
            publication_authorized: true as const,
            publication_mode: 'browser_required' as const,
            browser_work_item_id: workItem.id,
            published: false as const,
            replayed: false
        };
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            actor_id: args.actorId,
            command,
            idempotency_key: args.idempotencyKey,
            before_state: {
                request_hash: hash,
                manifest_checksum: manifestChecksum,
                status: task.status,
                publication_mode: task.publication_mode
            },
            after_state: result
        } });
        return result;
    });
}

export async function releaseVkBrowserTaskWithPrisma(args: VkBrowserReleaseArgs) {
    return releaseVkBrowserTask({
        transaction: (callback) => prisma.$transaction((tx) => callback(tx), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }),
        getManifestChecksum: async (projectId, actorId) => {
            const match = /^user:(\d+)$/.exec(actorId);
            if (!match) throw new Error('[OWNER_REQUIRED]');
            return (await loadAgentWorkspaceManifest(projectId, Number(match[1]))).checksum;
        },
        hashBody: (body) => createHash('sha256').update(body.trim()).digest('hex')
    }, args);
}

export async function claimVkBrowserPublication(args: {
    projectId: number;
    actorId: string;
    workItemId: number;
    leaseSeconds?: number;
    idempotencyKey: string;
}) {
    const item = await prisma.workItem.findFirst({
        where: {
            id: args.workItemId,
            project_id: args.projectId,
            kind: 'browser_publish',
            assignee_role: 'browser_publisher',
            content_item: {
                channel: { type: 'vk' },
                status: 'browser_required',
                publication_mode: 'browser_required',
                publication_fact: null,
                published_link: null
            }
        },
        select: { id: true }
    });
    if (!item) throw new Error('[VK_BROWSER_WORK_ITEM_REQUIRED]');
    return workQueueService.claimWorkItem(args);
}
