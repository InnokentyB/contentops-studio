import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED } from './vk_browser_submission_control.service';

export type VkBrowserPreProviderRecoveryGuards = {
    projectId: number;
    taskId: number;
    actorId: string;
    expectedChannelId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number;
    expectedBodySha256: string;
    expectedSelectedAssetId: number;
    expectedAssetSha256: string;
    expectedWorkItemId: number;
    expectedFailureCode: string;
};

export type VkBrowserPreProviderRecoveryApplyArgs = VkBrowserPreProviderRecoveryGuards & {
    expectedAttemptId: number;
    previewToken: string;
    reason: string;
    idempotencyKey: string;
};

type Dependencies = {
    transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
    hashBody(body: string): string;
};

function assetSha256(task: any) {
    const provenance = task?.selected_asset?.provenance;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null;
    const storage = (provenance as Record<string, any>).planner_storage;
    return typeof storage?.sha256 === 'string'
        ? storage.sha256
        : typeof (provenance as Record<string, any>).sha256 === 'string'
            ? (provenance as Record<string, any>).sha256
            : null;
}

function stableHash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function boundedPreview(tx: any, dependencies: Dependencies, args: VkBrowserPreProviderRecoveryGuards) {
    const userMatch = /^user:(\d+)$/.exec(args.actorId);
    if (!userMatch) throw new Error('[OWNER_REQUIRED]');
    const membership = await tx.projectMember.findUnique({ where: {
        project_id_user_id: { project_id: args.projectId, user_id: Number(userMatch[1]) }
    } });
    if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');

    const task = await tx.contentItem.findFirst({
        where: { id: args.taskId, project_id: args.projectId },
        include: { channel: true, selected_asset: true, publication_fact: true }
    });
    const workItem = await tx.workItem.findFirst({ where: {
        id: args.expectedWorkItemId,
        project_id: args.projectId,
        content_item_id: args.taskId
    } });
    const attempt = await tx.deliveryAttempt.findFirst({
        where: { project_id: args.projectId, content_item_id: args.taskId },
        orderBy: { id: 'desc' }
    });
    const uncertainEvent = await tx.workflowEvent.findFirst({ where: {
        project_id: args.projectId,
        content_item_id: args.taskId,
        work_item_id: args.expectedWorkItemId,
        command: 'ba_mark_vk_browser_submission_uncertain'
    }, orderBy: { id: 'desc' } });

    if (!task
        || task.channel_id !== args.expectedChannelId
        || task.channel?.type !== 'vk'
        || task.status !== 'publishing'
        || task.publication_mode !== 'browser_required'
        || task.content_revision !== args.expectedContentRevision
        || task.accepted_revision !== args.expectedAcceptedRevision
        || task.content_revision !== task.accepted_revision
        || task.text_state !== 'accepted'
        || task.visual_state !== 'APPROVED'
        || task.selected_asset_id !== args.expectedSelectedAssetId
        || task.selected_asset?.status !== 'approved'
        || task.selected_asset?.content_revision !== args.expectedContentRevision
        || dependencies.hashBody(task.draft_text || '') !== args.expectedBodySha256
        || assetSha256(task) !== args.expectedAssetSha256
        || task.publication_fact
        || task.published_link) {
        throw new Error('[VK_BROWSER_PRE_PROVIDER_RECOVERY_TASK_GUARD_FAILED]');
    }
    if (!workItem
        || workItem.kind !== 'browser_publish'
        || workItem.assignee_role !== 'browser_publisher'
        || workItem.state !== 'claimed') {
        throw new Error('[VK_BROWSER_PRE_PROVIDER_RECOVERY_WORK_ITEM_GUARD_FAILED]');
    }
    if (!attempt
        || attempt.channel_id !== args.expectedChannelId
        || attempt.mode !== 'assisted'
        || attempt.status !== 'pending'
        || attempt.requires_manual_confirmation !== true
        || attempt.error_message !== args.expectedFailureCode
        || !uncertainEvent
        || uncertainEvent.after_state?.delivery_attempt_id !== attempt.id
        || uncertainEvent.after_state?.retry_allowed !== false
        || uncertainEvent.after_state?.reason_code !== args.expectedFailureCode) {
        throw new Error('[VK_BROWSER_PRE_PROVIDER_RECOVERY_ATTEMPT_GUARD_FAILED]');
    }

    const bounded = {
        project_id: args.projectId,
        task_id: args.taskId,
        channel_id: args.expectedChannelId,
        content_revision: args.expectedContentRevision,
        accepted_revision: args.expectedAcceptedRevision,
        body_sha256: args.expectedBodySha256,
        selected_asset_id: args.expectedSelectedAssetId,
        asset_sha256: args.expectedAssetSha256,
        work_item_id: workItem.id,
        attempt_id: attempt.id,
        failure_code: attempt.error_message,
        before: {
            task_status: task.status,
            work_item_state: workItem.state,
            attempt_status: attempt.status,
            requires_manual_confirmation: attempt.requires_manual_confirmation
        },
        after: {
            task_status: 'browser_required',
            work_item_state: 'available',
            attempt_status: 'failed',
            requires_manual_confirmation: false,
            attempt_error: VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED
        },
        publication_fact_created: false,
        provider_contact: false
    };
    return { ...bounded, preview_token: `sha256:${stableHash(bounded)}` };
}

export async function previewVkBrowserPreProviderRecovery(dependencies: Dependencies, args: VkBrowserPreProviderRecoveryGuards) {
    return dependencies.transaction((tx) => boundedPreview(tx, dependencies, args));
}

export async function applyVkBrowserPreProviderRecovery(dependencies: Dependencies, args: VkBrowserPreProviderRecoveryApplyArgs) {
    if (args.reason.trim().length < 20) throw new Error('[RECOVERY_REASON_REQUIRED]');
    const requestHash = stableHash(args);
    return dependencies.transaction(async (tx) => {
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            actor_id: args.actorId,
            command: 'ba_apply_vk_browser_pre_provider_recovery',
            idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...prior.after_state, replayed: true };
        }

        const preview = await boundedPreview(tx, dependencies, args);
        if (preview.attempt_id !== args.expectedAttemptId || preview.preview_token !== args.previewToken) {
            throw new Error('[STALE_RECOVERY_PREVIEW]');
        }
        const attemptChanged = await tx.deliveryAttempt.updateMany({ where: {
            id: args.expectedAttemptId,
            project_id: args.projectId,
            content_item_id: args.taskId,
            status: 'pending',
            requires_manual_confirmation: true,
            error_message: args.expectedFailureCode
        }, data: {
            status: 'failed',
            requires_manual_confirmation: false,
            error_message: VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED
        } });
        const taskChanged = await tx.contentItem.updateMany({ where: {
            id: args.taskId,
            project_id: args.projectId,
            status: 'publishing',
            publication_mode: 'browser_required',
            content_revision: args.expectedContentRevision,
            accepted_revision: args.expectedAcceptedRevision
        }, data: { status: 'browser_required' } });
        const workItemChanged = await tx.workItem.updateMany({ where: {
            id: args.expectedWorkItemId,
            project_id: args.projectId,
            content_item_id: args.taskId,
            state: 'claimed'
        }, data: {
            state: 'available',
            lease_token: null,
            lease_actor_id: null,
            lease_expires_at: null,
            reason_code: 'OWNER_CONFIRMED_PRE_PROVIDER_ABORT',
            note: args.reason
        } });
        if (attemptChanged.count !== 1 || taskChanged.count !== 1 || workItemChanged.count !== 1) {
            throw new Error('[VK_BROWSER_PRE_PROVIDER_RECOVERY_CAS_CONFLICT]');
        }
        const result = {
            project_id: args.projectId,
            task_id: args.taskId,
            channel_id: args.expectedChannelId,
            work_item_id: args.expectedWorkItemId,
            recovered_attempt_id: args.expectedAttemptId,
            task_status: 'browser_required',
            work_item_state: 'available',
            attempt_status: 'failed',
            publication_fact_created: false,
            provider_contact: false,
            retry_requires_new_owner_confirmation: true,
            replayed: false
        };
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            work_item_id: args.expectedWorkItemId,
            actor_id: args.actorId,
            command: 'ba_apply_vk_browser_pre_provider_recovery',
            idempotency_key: args.idempotencyKey,
            before_state: { ...preview, reason: args.reason, request_hash: requestHash },
            after_state: result
        } });
        return result;
    });
}

const prismaDependencies: Dependencies = {
    transaction: (callback) => prisma.$transaction((tx) => callback(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    }),
    hashBody: (body) => createHash('sha256').update(body.trim()).digest('hex')
};

export const previewVkBrowserPreProviderRecoveryWithPrisma = (args: VkBrowserPreProviderRecoveryGuards) =>
    previewVkBrowserPreProviderRecovery(prismaDependencies, args);
export const applyVkBrowserPreProviderRecoveryWithPrisma = (args: VkBrowserPreProviderRecoveryApplyArgs) =>
    applyVkBrowserPreProviderRecovery(prismaDependencies, args);
