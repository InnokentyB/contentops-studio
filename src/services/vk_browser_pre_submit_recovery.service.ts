import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { VK_BROWSER_PRE_SUBMIT_ABORT_CONFIRMED } from './vk_browser_submission_control.service';

type Guards = {
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
    expectedFailureCode: '[VK_BROWSER_READBACK_UNCONFIRMED]';
    evidenceSha256: string;
    absenceObservedAt: string;
    expectedLatestProviderObjectId: string;
};

type ApplyArgs = Guards & {
    expectedAttemptId: number;
    previewToken: string;
    reason: string;
    idempotencyKey: string;
};

type Dependencies = {
    transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
    hashBody(body: string): string;
};

function hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assetSha256(task: any) {
    const provenance = task?.selected_asset?.provenance;
    const storage = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
        ? (provenance as Record<string, any>).planner_storage
        : null;
    return typeof storage?.sha256 === 'string'
        ? storage.sha256
        : typeof provenance?.sha256 === 'string' ? provenance.sha256 : null;
}

async function previewInTransaction(tx: any, dependencies: Dependencies, args: Guards) {
    if (args.projectId !== 10 || args.taskId !== 1019 || args.expectedWorkItemId !== 1516
        || args.expectedFailureCode !== '[VK_BROWSER_READBACK_UNCONFIRMED]'
        || !/^[a-f0-9]{64}$/.test(args.evidenceSha256)
        || !/^-\d+_\d+$/.test(args.expectedLatestProviderObjectId)
        || !Number.isFinite(new Date(args.absenceObservedAt).getTime())) {
        throw new Error('[VK_BROWSER_PRE_SUBMIT_RECOVERY_INCIDENT_GUARD_FAILED]');
    }
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
        id: args.expectedWorkItemId, project_id: args.projectId, content_item_id: args.taskId
    } });
    const attempt = await tx.deliveryAttempt.findFirst({
        where: { project_id: args.projectId, content_item_id: args.taskId }, orderBy: { id: 'desc' }
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
        || !['publishing', 'browser_required'].includes(task.status)
        || task.publication_mode !== 'browser_required'
        || task.content_revision !== args.expectedContentRevision
        || task.accepted_revision !== args.expectedAcceptedRevision
        || task.text_state !== 'accepted'
        || task.visual_state !== 'APPROVED'
        || task.selected_asset_id !== args.expectedSelectedAssetId
        || task.selected_asset?.status !== 'approved'
        || task.selected_asset?.content_revision !== args.expectedContentRevision
        || dependencies.hashBody(task.draft_text || '') !== args.expectedBodySha256
        || assetSha256(task) !== args.expectedAssetSha256
        || task.publication_fact
        || task.published_link) {
        throw new Error('[VK_BROWSER_PRE_SUBMIT_RECOVERY_TASK_GUARD_FAILED]');
    }
    if (!workItem || workItem.kind !== 'browser_publish'
        || workItem.assignee_role !== 'browser_publisher' || workItem.state !== 'claimed') {
        throw new Error('[VK_BROWSER_PRE_SUBMIT_RECOVERY_WORK_ITEM_GUARD_FAILED]');
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
        throw new Error('[VK_BROWSER_PRE_SUBMIT_RECOVERY_ATTEMPT_GUARD_FAILED]');
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
        evidence_sha256: args.evidenceSha256,
        absence_observed_at: new Date(args.absenceObservedAt).toISOString(),
        latest_provider_object_id: args.expectedLatestProviderObjectId,
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
            attempt_error: VK_BROWSER_PRE_SUBMIT_ABORT_CONFIRMED
        },
        publication_fact_created: false,
        provider_upload_observed: true,
        final_submit_observed: false
    };
    return { ...bounded, preview_token: `sha256:${hash(bounded)}` };
}

export const previewVkBrowserPreSubmitRecovery = (dependencies: Dependencies, args: Guards) =>
    dependencies.transaction((tx) => previewInTransaction(tx, dependencies, args));

export async function applyVkBrowserPreSubmitRecovery(dependencies: Dependencies, args: ApplyArgs) {
    if (args.reason.trim().length < 20) throw new Error('[RECOVERY_REASON_REQUIRED]');
    const requestHash = hash(args);
    return dependencies.transaction(async (tx) => {
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            actor_id: args.actorId,
            command: 'ba_apply_vk_browser_pre_submit_recovery',
            idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...prior.after_state, replayed: true };
        }
        const preview = await previewInTransaction(tx, dependencies, args);
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
            error_message: VK_BROWSER_PRE_SUBMIT_ABORT_CONFIRMED
        } });
        const taskChanged = await tx.contentItem.updateMany({ where: {
            id: args.taskId,
            project_id: args.projectId,
            status: { in: ['publishing', 'browser_required'] },
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
            reason_code: 'OWNER_CONFIRMED_PRE_SUBMIT_ABORT',
            note: args.reason
        } });
        if (attemptChanged.count !== 1 || taskChanged.count !== 1 || workItemChanged.count !== 1) {
            throw new Error('[VK_BROWSER_PRE_SUBMIT_RECOVERY_CAS_CONFLICT]');
        }
        const result = {
            project_id: args.projectId,
            task_id: args.taskId,
            work_item_id: args.expectedWorkItemId,
            recovered_attempt_id: args.expectedAttemptId,
            task_status: 'browser_required',
            work_item_state: 'available',
            attempt_status: 'failed',
            publication_fact_created: false,
            retry_requires_new_owner_confirmation: true,
            replayed: false
        };
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            work_item_id: args.expectedWorkItemId,
            actor_id: args.actorId,
            command: 'ba_apply_vk_browser_pre_submit_recovery',
            idempotency_key: args.idempotencyKey,
            before_state: { ...preview, reason: args.reason, request_hash: requestHash },
            after_state: result
        } });
        return result;
    });
}

const dependencies: Dependencies = {
    transaction: (callback) => prisma.$transaction((tx) => callback(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    }),
    hashBody: (body) => createHash('sha256').update(body.trim()).digest('hex')
};

export const previewVkBrowserPreSubmitRecoveryWithPrisma = (args: Guards) =>
    previewVkBrowserPreSubmitRecovery(dependencies, args);
export const applyVkBrowserPreSubmitRecoveryWithPrisma = (args: ApplyArgs) =>
    applyVkBrowserPreSubmitRecovery(dependencies, args);
