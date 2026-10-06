import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import publicationFactService from './publication_fact.service';

type StartArgs = {
    projectId: number;
    taskId: number;
    channelId: number;
    actorId: string;
    workItemId: number;
    leaseToken: string;
    approvalReference: string;
    idempotencyKey: string;
    contentRevision: number;
    textSha256: string;
    imageSha256: string | null;
    selectedAssetId: number | null;
};

type ConfirmArgs = StartArgs & {
    attemptId: number;
    publicUrl: string;
    providerObjectId: string;
    publishedAt: string;
    evidenceSha256: string;
};

type UncertainArgs = {
    projectId: number;
    taskId: number;
    actorId: string;
    workItemId: number;
    leaseToken: string;
    attemptId: number;
    reasonCode: string;
    idempotencyKey: string;
};

type Dependencies = {
    transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
    now(): Date;
    hashBody(body: string): string;
    recordFact(args: any): Promise<any>;
};

export const VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED = '[VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED]';
export const VK_BROWSER_PRE_SUBMIT_ABORT_CONFIRMED = '[VK_BROWSER_PRE_SUBMIT_ABORT_CONFIRMED]';

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

function releasePayload(workItem: any) {
    return workItem?.result_payload && typeof workItem.result_payload === 'object'
        ? workItem.result_payload as Record<string, any>
        : {};
}

function assertLease(workItem: any, args: { projectId: number; taskId: number; actorId: string; workItemId: number; leaseToken: string }, now: Date) {
    if (!workItem
        || workItem.id !== args.workItemId
        || workItem.project_id !== args.projectId
        || workItem.content_item_id !== args.taskId
        || workItem.kind !== 'browser_publish'
        || workItem.assignee_role !== 'browser_publisher'
        || workItem.state !== 'claimed'
        || workItem.lease_token !== args.leaseToken
        || workItem.lease_actor_id !== args.actorId
        || !workItem.lease_expires_at
        || new Date(workItem.lease_expires_at).getTime() < now.getTime()) {
        throw new Error('[VK_BROWSER_ACTIVE_LEASE_REQUIRED] Active owner-released browser lease is required');
    }
}

function assertExactTask(task: any, workItem: any, args: StartArgs, allowedStatuses: string[]) {
    const release = releasePayload(workItem);
    if (!task
        || task.id !== args.taskId
        || task.project_id !== args.projectId
        || task.channel_id !== args.channelId
        || task.channel?.type !== 'vk'
        || !allowedStatuses.includes(task.status)
        || task.publication_mode !== 'browser_required'
        || task.content_revision !== args.contentRevision
        || task.accepted_revision !== args.contentRevision
        || task.text_state !== 'accepted'
        || task.selected_asset_id !== args.selectedAssetId
        || (args.selectedAssetId !== null && (task.selected_asset?.status !== 'approved'
            || task.selected_asset?.content_revision !== args.contentRevision))
        || task.publication_fact || task.published_link
        || release.publication_authorized !== true
        || release.approval_reference !== args.approvalReference
        || release.content_revision !== args.contentRevision
        || release.body_sha256 !== args.textSha256
        || release.selected_asset_id !== args.selectedAssetId
        || (release.asset_sha256 ?? null) !== args.imageSha256
        || release.channel_id !== args.channelId) {
        throw new Error('[VK_BROWSER_SUBMISSION_GUARD_FAILED] Exact owner-released VK task is required');
    }
}

function validateProviderIdentity(task: any, args: ConfirmArgs) {
    let url: URL;
    try {
        url = new URL(args.publicUrl);
    } catch {
        throw new Error('[VK_BROWSER_PROVIDER_IDENTITY_INVALID]');
    }
    const match = /^\/wall(-\d+)_(\d+)$/.exec(url.pathname);
    const ownerId = String(task?.channel?.config?.vk_id || '');
    const publishedAt = new Date(args.publishedAt);
    if (url.protocol !== 'https:'
        || !['vk.com', 'www.vk.com', 'vk.ru', 'www.vk.ru'].includes(url.hostname.toLowerCase())
        || !match || match[1] !== ownerId
        || args.providerObjectId !== `${match[1]}_${match[2]}`
        || !Number.isFinite(publishedAt.getTime())
        || !/^[a-f0-9]{64}$/.test(args.evidenceSha256)) {
        throw new Error('[VK_BROWSER_PROVIDER_IDENTITY_INVALID]');
    }
    return { publicUrl: `https://vk.com/wall${args.providerObjectId}`, publishedAt: publishedAt.toISOString() };
}

export async function startVkBrowserSubmission(dependencies: Dependencies, args: StartArgs) {
    return dependencies.transaction(async (tx) => {
        const now = dependencies.now();
        const workItem = await tx.workItem.findFirst({ where: { id: args.workItemId, project_id: args.projectId } });
        assertLease(workItem, args, now);
        const task = await tx.contentItem.findFirst({
            where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        const existing = await tx.deliveryAttempt.findFirst({
            where: { project_id: args.projectId, content_item_id: args.taskId },
            orderBy: { id: 'desc' }
        });
        const rearmedPreProviderFailure = existing?.status === 'failed'
            && existing.requires_manual_confirmation === false
            && [VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED, VK_BROWSER_PRE_SUBMIT_ABORT_CONFIRMED]
                .includes(existing.error_message || '');
        if (existing && !rearmedPreProviderFailure) {
            if (existing.idempotency_key !== args.idempotencyKey) throw new Error('[VK_BROWSER_ATTEMPT_EXISTS] Retry is forbidden');
            if (task?.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
                return {
                    status: 'confirmed' as const,
                    attempt_id: existing.id,
                    publication_fact_id: task.publication_fact.id,
                    public_url: task.publication_fact.public_url,
                    replayed: true
                };
            }
            return {
                status: 'verification_required' as const,
                attempt_id: existing.id,
                retry_allowed: false as const,
                replayed: true
            };
        }
        assertExactTask(task, workItem, args, ['browser_required']);
        if (dependencies.hashBody(task.draft_text || '') !== args.textSha256
            || assetSha256(task) !== args.imageSha256) {
            throw new Error('[VK_BROWSER_PAYLOAD_HASH_MISMATCH]');
        }
        const attempt = await tx.deliveryAttempt.create({ data: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            channel_id: args.channelId,
            mode: 'assisted',
            status: 'pending',
            attempt_number: existing ? existing.attempt_number + 1 : 1,
            idempotency_key: args.idempotencyKey,
            scheduled_at: task.schedule_at || task.publish_at || now,
            actual_published_at: null,
            requires_manual_confirmation: true,
            error_message: null
        } });
        const changed = await tx.contentItem.updateMany({
            where: {
                id: args.taskId,
                project_id: args.projectId,
                status: 'browser_required',
                publication_mode: 'browser_required',
                content_revision: args.contentRevision,
                accepted_revision: args.contentRevision
            },
            data: { status: 'publishing' }
        });
        if (changed.count !== 1) throw new Error('[VK_BROWSER_START_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            work_item_id: args.workItemId,
            actor_id: args.actorId,
            command: 'ba_start_vk_browser_submission',
            idempotency_key: args.idempotencyKey,
            before_state: { status: task.status, publication_fact_id: null },
            after_state: { status: 'publishing', delivery_attempt_id: attempt.id }
        } });
        return { status: 'started' as const, attempt_id: attempt.id, replayed: false };
    });
}

export async function confirmVkBrowserSubmission(dependencies: Dependencies, args: ConfirmArgs) {
    const checked = await dependencies.transaction(async (tx) => {
        const now = dependencies.now();
        const workItem = await tx.workItem.findFirst({ where: { id: args.workItemId, project_id: args.projectId } });
        assertLease(workItem, args, now);
        const task = await tx.contentItem.findFirst({
            where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        if (task?.publication_fact?.outcome === 'published' && task.publication_fact.public_url) {
            return { replayedFactId: task.publication_fact.id, task, identity: validateProviderIdentity(task, args) };
        }
        assertExactTask(task, workItem, args, ['publishing']);
        if (dependencies.hashBody(task.draft_text || '') !== args.textSha256
            || assetSha256(task) !== args.imageSha256) {
            throw new Error('[VK_BROWSER_PAYLOAD_HASH_MISMATCH]');
        }
        const attempt = await tx.deliveryAttempt.findFirst({ where: {
            id: args.attemptId,
            project_id: args.projectId,
            content_item_id: args.taskId,
            channel_id: args.channelId,
            idempotency_key: args.idempotencyKey
        } });
        if (!attempt || !['pending', 'delivered'].includes(attempt.status)) {
            throw new Error('[VK_BROWSER_ATTEMPT_NOT_CONFIRMABLE]');
        }
        return { replayedFactId: null, task, identity: validateProviderIdentity(task, args) };
    });
    if (checked.replayedFactId) {
        return { publication_fact_id: checked.replayedFactId, replayed: true };
    }
    const factResult = await dependencies.recordFact({
        projectId: args.projectId,
        taskId: args.taskId,
        actorId: args.actorId,
        artifactKind: 'post',
        outcome: 'published',
        publishedAt: checked.identity.publishedAt,
        publicUrl: checked.identity.publicUrl,
        providerObjectId: args.providerObjectId,
        confirmationMode: 'reconciled',
        evidence: { type: 'screenshot', ref: `sha256:${args.evidenceSha256}` },
        utmStatus: 'not_applicable',
        note: 'VK browser publication confirmed by exact provider readback.'
    });
    const publicationFactId = factResult.publication_fact.id;
    await dependencies.transaction(async (tx) => {
        const changed = await tx.deliveryAttempt.updateMany({
            where: {
                id: args.attemptId,
                project_id: args.projectId,
                content_item_id: args.taskId,
                idempotency_key: args.idempotencyKey,
                status: 'pending'
            },
            data: {
                status: 'delivered',
                actual_published_at: new Date(checked.identity.publishedAt),
                requires_manual_confirmation: false,
                error_message: null
            }
        });
        if (changed.count !== 1) {
            const attempt = await tx.deliveryAttempt.findFirst({ where: { id: args.attemptId } });
            if (attempt?.status !== 'delivered') throw new Error('[VK_BROWSER_CONFIRM_CAS_CONFLICT]');
        }
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            work_item_id: args.workItemId,
            actor_id: args.actorId,
            command: 'ba_confirm_vk_browser_submission',
            idempotency_key: `${args.idempotencyKey}:confirm`,
            before_state: { delivery_attempt_id: args.attemptId, status: 'pending' },
            after_state: { delivery_attempt_id: args.attemptId, status: 'delivered', publication_fact_id: publicationFactId }
        } });
    });
    return { publication_fact_id: publicationFactId, replayed: false };
}

export async function markVkBrowserSubmissionUncertain(dependencies: Dependencies, args: UncertainArgs) {
    return dependencies.transaction(async (tx) => {
        const workItem = await tx.workItem.findFirst({ where: { id: args.workItemId, project_id: args.projectId } });
        assertLease(workItem, args, dependencies.now());
        const changed = await tx.deliveryAttempt.updateMany({
            where: {
                id: args.attemptId,
                project_id: args.projectId,
                content_item_id: args.taskId,
                idempotency_key: args.idempotencyKey,
                status: 'pending'
            },
            data: {
                status: 'pending',
                requires_manual_confirmation: true,
                error_message: args.reasonCode
            }
        });
        if (changed.count !== 1) throw new Error('[VK_BROWSER_UNCERTAIN_CAS_CONFLICT]');
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId,
            content_item_id: args.taskId,
            work_item_id: args.workItemId,
            actor_id: args.actorId,
            command: 'ba_mark_vk_browser_submission_uncertain',
            idempotency_key: `${args.idempotencyKey}:uncertain`,
            before_state: { delivery_attempt_id: args.attemptId },
            after_state: { delivery_attempt_id: args.attemptId, status: 'pending', retry_allowed: false, reason_code: args.reasonCode }
        } });
        return { status: 'verification_required' as const, attempt_id: args.attemptId, retry_allowed: false };
    });
}

const prismaDependencies: Dependencies = {
    transaction: (callback) => prisma.$transaction((tx) => callback(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    }),
    now: () => new Date(),
    hashBody: (body) => createHash('sha256').update(body.trim()).digest('hex'),
    recordFact: (args) => publicationFactService.record(args)
};

export const startVkBrowserSubmissionWithPrisma = (args: StartArgs) => startVkBrowserSubmission(prismaDependencies, args);
export const confirmVkBrowserSubmissionWithPrisma = (args: ConfirmArgs) => confirmVkBrowserSubmission(prismaDependencies, args);
export const markVkBrowserSubmissionUncertainWithPrisma = (args: UncertainArgs) => markVkBrowserSubmissionUncertain(prismaDependencies, args);
