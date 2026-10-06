import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export type DzenOwnerReleaseArgs = {
    projectId: number;
    taskId: number;
    actorId: string;
    expectedChannelId: number;
    expectedContentRevision: number;
    expectedAcceptedRevision: number;
    expectedBodySha256: string;
    expectedVisualState: 'NO_VISUAL_NEEDED' | 'APPROVED';
    expectedPlacement: string;
    expectedVisualDecisionVersion: number;
    expectedSelectedAssetId: number | null;
    expectedAssetSha256: string | null;
    expectedScheduleAt: string;
    expectedPublishAt: string;
    expectedManifestChecksum: string;
    approvalReference: string;
    idempotencyKey: string;
};

type DzenReleaseResult = {
    project_id: number; task_id: number; channel_id: number;
    content_revision: number; accepted_revision: number; body_sha256: string;
    visual_state: string; placement: string; visual_decision_version: number;
    visual_decision_id: number;
    selected_asset_id: number | null; asset_sha256: string | null;
    schedule_at: string; publish_at: string; publication_mode: 'owner_released';
    explicit_send_required: true; published: false; replayed: boolean;
};

type DzenReleaseTask = {
    id: number; project_id: number; channel_id: number | null;
    channel: { type: string; name: string } | null;
    status: string; handoff_state: string; publication_mode: string;
    content_revision: number; accepted_revision: number | null; text_state: string;
    draft_text: string | null; visual_state: string; visual_placement: string | null;
    visual_decision_version: number; selected_asset_id: number | null;
    selected_asset: { status: string; content_revision: number; file_url: string | null; provenance: unknown } | null;
    schedule_at: Date | null; publish_at: Date | null;
    publication_fact: unknown; published_link: string | null;
};

type DzenVisualDecision = {
    id: number; decision: string; source_content_revision: number; decision_version: number;
    placement: string; channel: string; status: string;
};

type Transaction = {
    projectMember: { findUnique(args: unknown): Promise<{ role: string } | null> };
    workflowEvent: {
        findFirst(args: unknown): Promise<{ before_state?: Record<string, unknown>; after_state?: Record<string, unknown> } | null>;
        create(args: unknown): Promise<unknown>;
    };
    contentItem: {
        findFirst(args: unknown): Promise<DzenReleaseTask | null>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
    artDirectionDecision: { findFirst(args: unknown): Promise<DzenVisualDecision | null> };
    deliveryAttempt: { findFirst(args: unknown): Promise<unknown> };
};

export type DzenOwnerReleaseDependencies = {
    transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
    getManifestChecksum(projectId: number, actorId: string): Promise<string>;
    hashBody(body: string): string;
};

function sha256(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assetSha256(asset: DzenReleaseTask['selected_asset'] | undefined): string | null {
    const provenance = asset?.provenance;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null;
    const record = provenance as Record<string, unknown>;
    const storage = record.planner_storage;
    if (storage && typeof storage === 'object' && !Array.isArray(storage)) {
        const checksum = (storage as Record<string, unknown>).sha256;
        if (typeof checksum === 'string') return checksum;
    }
    return typeof record.sha256 === 'string' ? record.sha256 : null;
}

/**
 * Owner-only exact-package release for a Dzen task. This mutates only the
 * publication authorization state; it never contacts Dzen or records a fact.
 */
export async function releaseDzenTask(
    deps: DzenOwnerReleaseDependencies,
    args: DzenOwnerReleaseArgs
): Promise<DzenReleaseResult> {
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    if (!/^sha256:[a-f0-9]{64}$/i.test(args.expectedManifestChecksum)) throw new Error('[INVALID_MANIFEST_CHECKSUM]');
    if (!/^[a-f0-9]{64}$/i.test(args.expectedBodySha256)) throw new Error('[INVALID_BODY_SHA256]');
    const scheduleAt = new Date(args.expectedScheduleAt);
    const publishAt = new Date(args.expectedPublishAt);
    if (!Number.isFinite(scheduleAt.getTime()) || !Number.isFinite(publishAt.getTime())) {
        throw new Error('[INVALID_SCHEDULE]');
    }
    const user = /^user:(\d+)$/.exec(args.actorId);
    if (!user) throw new Error('[OWNER_REQUIRED]');
    const requestHash = sha256(args);

    return deps.transaction(async (tx) => {
        const member = await tx.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: args.projectId, user_id: Number(user[1]) }
        } });
        if (member?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const manifestChecksum = await deps.getManifestChecksum(args.projectId, args.actorId);
        if (manifestChecksum !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
        const command = 'ba_release_approved_dzen_task';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId, actor_id: args.actorId, command,
            idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if (prior.before_state?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(prior.after_state as Omit<DzenReleaseResult, 'replayed'>), replayed: true };
        }

        const task = await tx.contentItem.findFirst({
            where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true }
        });
        const decision = await tx.artDirectionDecision.findFirst({ where: {
            project_id: args.projectId, content_item_id: args.taskId,
            source_content_revision: args.expectedContentRevision,
            decision_version: args.expectedVisualDecisionVersion,
            status: 'active'
        } });
        const bodyHash = deps.hashBody(task?.draft_text || '');
        const currentAssetSha = assetSha256(task?.selected_asset);
        const noVisual = args.expectedVisualState === 'NO_VISUAL_NEEDED';
        const visualMatches = noVisual
            ? args.expectedSelectedAssetId === null && args.expectedAssetSha256 === null
                && task?.selected_asset_id === null && decision?.decision === 'NO_VISUAL_NEEDED'
            : args.expectedSelectedAssetId !== null && task?.selected_asset_id === args.expectedSelectedAssetId
                && task?.selected_asset?.status === 'approved'
                && task?.selected_asset?.content_revision === args.expectedContentRevision
                && Boolean(task?.selected_asset?.file_url) && currentAssetSha === args.expectedAssetSha256;
        if (!task || task.channel_id !== args.expectedChannelId || task.channel?.type !== 'dzen'
            || task.content_revision !== args.expectedContentRevision
            || task.accepted_revision !== args.expectedAcceptedRevision
            || task.content_revision !== task.accepted_revision || task.text_state !== 'accepted'
            || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
            || task.publication_mode !== 'approval_required'
            || task.visual_state !== args.expectedVisualState
            || task.visual_placement !== args.expectedPlacement
            || task.visual_decision_version !== args.expectedVisualDecisionVersion
            || decision?.source_content_revision !== args.expectedContentRevision
            || decision?.decision_version !== args.expectedVisualDecisionVersion
            || decision?.placement !== args.expectedPlacement
            || !['dzen', task.channel.name].includes(decision?.channel)
            || !visualMatches || task.schedule_at?.toISOString() !== args.expectedScheduleAt
            || task.publish_at?.toISOString() !== args.expectedPublishAt
            || bodyHash !== args.expectedBodySha256 || task.publication_fact || task.published_link) {
            throw new Error('[DZEN_OWNER_RELEASE_GUARD_FAILED] Exact accepted Dzen package is required');
        }
        if (await tx.deliveryAttempt.findFirst({ where: {
            project_id: args.projectId, content_item_id: args.taskId
        } })) throw new Error('[DELIVERY_ATTEMPT_EXISTS] Existing attempt requires reconciliation');
        const checksumBeforeCas = await deps.getManifestChecksum(args.projectId, args.actorId);
        if (checksumBeforeCas !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST]');
        const changed = await tx.contentItem.updateMany({ where: {
            id: args.taskId, project_id: args.projectId, channel_id: args.expectedChannelId,
            content_revision: args.expectedContentRevision, accepted_revision: args.expectedAcceptedRevision,
            text_state: 'accepted', status: 'ready_for_execution', handoff_state: 'ready',
            publication_mode: 'approval_required', visual_state: args.expectedVisualState,
            visual_placement: args.expectedPlacement,
            visual_decision_version: args.expectedVisualDecisionVersion,
            selected_asset_id: args.expectedSelectedAssetId,
            schedule_at: scheduleAt, publish_at: publishAt
        }, data: { publication_mode: 'owner_released' } });
        if (changed.count !== 1) throw new Error('[DZEN_OWNER_RELEASE_CAS_CONFLICT]');
        const result: DzenReleaseResult = {
            project_id: args.projectId, task_id: args.taskId, channel_id: args.expectedChannelId,
            content_revision: args.expectedContentRevision, accepted_revision: args.expectedAcceptedRevision,
            body_sha256: bodyHash, visual_state: args.expectedVisualState,
            placement: args.expectedPlacement, visual_decision_version: args.expectedVisualDecisionVersion,
            visual_decision_id: decision!.id,
            selected_asset_id: args.expectedSelectedAssetId, asset_sha256: args.expectedAssetSha256,
            schedule_at: args.expectedScheduleAt, publish_at: args.expectedPublishAt,
            publication_mode: 'owner_released', explicit_send_required: true,
            published: false, replayed: false
        };
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId, content_item_id: args.taskId, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, manifest_checksum: manifestChecksum,
                publication_mode: 'approval_required', approval_reference: args.approvalReference },
            after_state: result
        } });
        return result;
    });
}

export async function releaseDzenTaskWithPrisma(args: DzenOwnerReleaseArgs) {
    return releaseDzenTask({
        transaction: (callback) => prisma.$transaction(
            tx => callback(tx as unknown as Transaction),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        ),
        getManifestChecksum: async (projectId, actorId) => {
            const user = /^user:(\d+)$/.exec(actorId);
            if (!user) throw new Error('[OWNER_REQUIRED]');
            return (await loadAgentWorkspaceManifest(projectId, Number(user[1]))).checksum;
        },
        hashBody: body => createHash('sha256').update(body).digest('hex')
    }, args);
}
