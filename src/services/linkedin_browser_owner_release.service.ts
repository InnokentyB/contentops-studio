import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import publicationAdapterService from './publication_adapter.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import workQueueService from './work_queue.service';

export type LinkedInBrowserReleaseArgs = {
    projectId: number;
    taskId: number;
    actorId: string;
    expectedChannelId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number;
    expectedBodySha256: string;
    expectedSelectedAssetId: number | null;
    expectedAssetSha256: string | null;
    expectedVisualDecisionId?: number;
    expectedScheduleAt: string;
    expectedManifestChecksum: string;
    approvalReference: string;
    idempotencyKey: string;
    /** Exact task tools may recover a prepared browser_required task that has no work item or attempt. */
    allowPreparedBrowserState?: boolean;
};

type ReleaseTask = {
    id: number; project_id: number; week_package_id: number | null; item_key: string | null;
    channel_id: number | null; channel: { type: string; name: string; config?: unknown } | null;
    status: string; handoff_state: string; publication_mode: string;
    content_revision: number; accepted_revision: number | null; text_state: string; draft_text: string | null;
    visual_state: string; visual_placement: string | null; selected_asset_id: number | null;
    visual_decision_version?: number;
    selected_asset: { id: number; status: string; content_revision: number; file_url: string | null;
        provenance: unknown } | null;
    schedule_at: Date | null; publish_at: Date | null; publication_fact: unknown; published_link: string | null;
    quality_report: unknown;
};

type ReleaseEvent = { before_state?: Record<string, unknown>; after_state?: Record<string, unknown> } | null;
type ReleaseTransaction = {
    projectMember: { findUnique(args: unknown): Promise<{ role: string } | null> };
    workflowEvent: {
        findFirst(args: unknown): Promise<ReleaseEvent>;
        create(args: unknown): Promise<unknown>;
    };
    contentItem: {
        findFirst(args: unknown): Promise<ReleaseTask | null>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
    deliveryAttempt: { findFirst(args: unknown): Promise<unknown> };
    artDirectionDecision?: { findFirst(args: unknown): Promise<{
        id: number; decision: string; source_content_revision: number; decision_version: number;
        channel: string; placement: string; status: string;
    } | null> };
    workItem: {
        findFirst(args: unknown): Promise<{ id: number } | null>;
        create(args: { data: Record<string, unknown> }): Promise<{ id: number }>;
    };
};

export type LinkedInBrowserReleaseDependencies = {
    transaction<T>(callback: (tx: ReleaseTransaction) => Promise<T>): Promise<T>;
    getManifestChecksum(projectId: number, actorId: string): Promise<string>;
    hashBody(body: string): string;
};

export type LinkedInBrowserReleaseResult = {
    project_id: number;
    task_id: number;
    channel_id: number;
    content_revision: number;
    accepted_revision: number;
    body_sha256: string;
    selected_asset_id: number | null;
    asset_sha256: string | null;
    schedule_at: string;
    publication_authorized: true;
    publication_mode: 'browser_required';
    browser_work_item_id: number;
    published: false;
    replayed: boolean;
};

function assetSha256(task: ReleaseTask) {
    const provenance = task.selected_asset?.provenance;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null;
    const record = provenance as Record<string, unknown>;
    const storage = record.planner_storage;
    if (storage && typeof storage === 'object' && !Array.isArray(storage)) {
        const checksum = (storage as Record<string, unknown>).sha256;
        if (typeof checksum === 'string') return checksum;
    }
    return typeof record.sha256 === 'string' ? record.sha256 : null;
}

function requestHash(args: LinkedInBrowserReleaseArgs) {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

/**
 * Owner-only CAS release that materializes one LinkedIn browser publication work item.
 * It never contacts LinkedIn and never records a publication fact.
 */
export async function releaseLinkedInBrowserTask(
    dependencies: LinkedInBrowserReleaseDependencies,
    args: LinkedInBrowserReleaseArgs
): Promise<LinkedInBrowserReleaseResult> {
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    if (!args.idempotencyKey.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
    if ((args.expectedSelectedAssetId === null) !== (args.expectedAssetSha256 === null)) {
        throw new Error('[INVALID_VISUAL_BINDING] Asset ID and checksum must both be present or both null');
    }
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
        const command = 'ba_release_approved_linkedin_browser_task';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if (prior.before_state?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Omit<LinkedInBrowserReleaseResult, 'replayed'>), replayed: true };
        }

        const task = await tx.contentItem.findFirst({ where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const bodyHash = dependencies.hashBody(task?.draft_text || '');
        const noVisual = args.expectedSelectedAssetId === null;
        const decision = noVisual ? await tx.artDirectionDecision?.findFirst({ where: {
            project_id: args.projectId, content_item_id: args.taskId, status: 'active',
            source_content_revision: args.expectedContentRevision,
            decision_version: task?.visual_decision_version
        } }) : null;
        const visualMatches = noVisual
            ? args.expectedAssetSha256 === null && task?.visual_state === 'NO_VISUAL_NEEDED'
                && task.selected_asset_id === null && task.selected_asset === null
                && decision?.decision === 'NO_VISUAL_NEEDED' && decision.status === 'active'
                && (args.expectedVisualDecisionId === undefined || decision.id === args.expectedVisualDecisionId)
                && decision.source_content_revision === args.expectedContentRevision
                && decision.decision_version === task.visual_decision_version
                && decision.placement === 'feed'
                && ['linkedin', task.channel?.name].includes(decision.channel)
            : task?.visual_state === 'APPROVED' && task.selected_asset_id === args.expectedSelectedAssetId
                && task.selected_asset?.status === 'approved'
                && task.selected_asset.content_revision === args.expectedContentRevision
                && Boolean(task.selected_asset.file_url) && assetSha256(task) === args.expectedAssetSha256;
        const channelConfig = task?.channel
            ? resolveEffectiveChannelConfig('linkedin', task.channel.config || {})
            : {};
        const browserAssisted = task?.channel?.type === 'linkedin'
            && !publicationAdapterService.supportsDirectExecution({
                ...channelConfig,
                ...((channelConfig.raw_account as Record<string, unknown> | undefined) || {}),
                platform: 'linkedin'
            });
        const preparedBrowserState = args.allowPreparedBrowserState === true
            && task?.status === 'browser_required' && task.publication_mode === 'browser_required';
        const releaseableState = task?.status === 'ready_for_execution'
            && task.publication_mode === 'approval_required';
        if (!task || task.channel_id !== args.expectedChannelId || !browserAssisted
            || (!releaseableState && !preparedBrowserState) || task.handoff_state !== 'ready'
            || task.content_revision !== args.expectedContentRevision
            || task.accepted_revision !== args.expectedAcceptedRevision
            || task.content_revision !== task.accepted_revision || task.text_state !== 'accepted'
            || !visualMatches || task.visual_placement !== 'feed'
            || task.schedule_at?.toISOString() !== args.expectedScheduleAt
            || bodyHash !== args.expectedBodySha256 || task.publication_fact || task.published_link) {
            throw new Error('[OWNER_RELEASE_GUARD_FAILED] Exact accepted LinkedIn browser task is required');
        }
        if (await tx.deliveryAttempt.findFirst({ where: {
            project_id: args.projectId, content_item_id: args.taskId
        } })) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        if (await tx.workItem.findFirst({ where: {
            project_id: args.projectId, content_item_id: args.taskId, kind: 'browser_publish',
            state: { notIn: ['completed', 'cancelled'] }
        } })) throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');

        const checksumBeforeCas = await dependencies.getManifestChecksum(args.projectId, args.actorId);
        if (checksumBeforeCas !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
        const changed = await tx.contentItem.updateMany({ where: {
            id: args.taskId, project_id: args.projectId, channel_id: args.expectedChannelId,
            status: task.status, handoff_state: 'ready', publication_mode: task.publication_mode,
            content_revision: args.expectedContentRevision, accepted_revision: args.expectedAcceptedRevision,
            text_state: 'accepted', visual_state: task.visual_state, visual_placement: 'feed',
            ...(noVisual ? { visual_decision_version: task.visual_decision_version } : {}),
            selected_asset_id: args.expectedSelectedAssetId, schedule_at: expectedSchedule
        }, data: {
            status: 'browser_required', publication_mode: 'browser_required',
            quality_report: {
                ...((task.quality_report as Record<string, unknown> | null) || {}),
                publication_route: 'browser_required',
                owner_release: {
                    publication_authorized: true, actor_id: args.actorId,
                    approval_reference: args.approvalReference,
                    content_revision: args.expectedContentRevision,
                    body_sha256: bodyHash, selected_asset_id: args.expectedSelectedAssetId,
                    asset_sha256: args.expectedAssetSha256, released_at: new Date().toISOString()
                }
            }
        } });
        if (changed.count !== 1) throw new Error('[OWNER_RELEASE_CAS_CONFLICT]');
        const workItem = await tx.workItem.create({ data: {
            project_id: args.projectId, week_package_id: task.week_package_id,
            content_item_id: args.taskId, item_key: task.item_key || `publication-${args.taskId}`,
            kind: 'browser_publish', state: 'available', assignee_role: 'browser_publisher',
            due_at: task.schedule_at || task.publish_at || new Date(),
            reason_code: 'OWNER_RELEASED_BROWSER_PUBLICATION',
            note: 'Owner released the exact accepted LinkedIn revision for one browser publication.',
            result_payload: {
                publication_authorized: true, content_revision: args.expectedContentRevision,
                body_sha256: bodyHash, selected_asset_id: args.expectedSelectedAssetId,
                asset_sha256: args.expectedAssetSha256, channel_id: args.expectedChannelId
            },
            input_context_version: args.expectedContentRevision,
            dedupe_key: `browser_publish:${args.taskId}:r${args.expectedContentRevision}`
        } });
        const result: LinkedInBrowserReleaseResult = {
            project_id: args.projectId, task_id: args.taskId, channel_id: args.expectedChannelId,
            content_revision: args.expectedContentRevision, accepted_revision: args.expectedAcceptedRevision,
            body_sha256: bodyHash, selected_asset_id: args.expectedSelectedAssetId,
            asset_sha256: args.expectedAssetSha256, schedule_at: args.expectedScheduleAt,
            publication_authorized: true, publication_mode: 'browser_required',
            browser_work_item_id: workItem.id, published: false, replayed: false
        };
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId, content_item_id: args.taskId, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, manifest_checksum: manifestChecksum,
                status: task.status, publication_mode: task.publication_mode },
            after_state: result
        } });
        return result;
    });
}

export async function releaseLinkedInBrowserTaskWithPrisma(args: LinkedInBrowserReleaseArgs) {
    return releaseLinkedInBrowserTask({
        transaction: (callback) => prisma.$transaction((tx) => callback(tx as unknown as ReleaseTransaction), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }),
        getManifestChecksum: async (projectId, actorId) => {
            const match = /^user:(\d+)$/.exec(actorId);
            if (!match) throw new Error('[OWNER_REQUIRED]');
            return (await loadAgentWorkspaceManifest(projectId, Number(match[1]))).checksum;
        },
        hashBody: (body) => createHash('sha256').update(body).digest('hex')
    }, args);
}

/**
 * Publisher-scoped claim for an owner-released LinkedIn browser work item.
 * The generic work queue claim stays hidden from Publisher so other roles' work cannot be claimed.
 */
export async function claimLinkedInBrowserPublication(args: {
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
                channel: { type: 'linkedin' },
                status: 'browser_required',
                publication_mode: 'browser_required',
                publication_fact: null,
                published_link: null
            }
        },
        select: { id: true }
    });
    if (!item) throw new Error('[LINKEDIN_BROWSER_WORK_ITEM_REQUIRED]');
    return workQueueService.claimWorkItem(args);
}
