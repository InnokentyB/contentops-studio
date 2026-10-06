import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

const THREADS_966_BODY_SHA256 = '83dd0fe0b2b354898b9fd3e5161d5ab05517c4c2b2304862d74c949ce1e2b123';
const THREADS_1029_BODY_SHA256 = 'f59a4e27a001c2b6fd297683d626c1f2479125d184896036d91c2e3edae6666e';
const TASK_969_BODY_SHA256 = '43cff698cbb2597144a5fd696013b361961cd9d7c824809d6c4279d45391d1e9';

type Dependencies = {
    db: any;
    hashBody: (body: string) => string;
    requireOwner: (tx: any, projectId: number, actorId: string) => Promise<void>;
    getManifestChecksum?: (projectId: number, actorId: string) => Promise<string>;
};

export type Threads966Release = {
    projectId: number; actorId: string; taskId: number; expectedChannelId: number;
    expectedContentRevision: number; expectedAcceptedRevision: number;
    expectedScheduleAt: string; expectedBodySha256: string;
    approvalReference: string; idempotencyKey: string;
};

export type Threads1029Release = Threads966Release;

export async function releaseThreadsTask1029(deps: Dependencies, args: Threads1029Release) {
    if (args.projectId !== 10 || args.taskId !== 1029 || args.expectedChannelId !== 138
        || args.expectedContentRevision !== 3 || args.expectedAcceptedRevision !== 3
        || args.expectedBodySha256 !== THREADS_1029_BODY_SHA256) {
        throw new Error('[THREADS_1029_SCOPE_MISMATCH] Exact task/revision/body required');
    }
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    const hash = requestHash(args);
    return deps.db.$transaction(async (tx: any) => {
        await deps.requireOwner(tx, 10, args.actorId);
        const command = 'ba_release_approved_threads_task1029';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior) {
            if (prior.before_state?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return prior.after_state;
        }
        const task = await tx.contentItem.findFirst({ where: { id: 1029, project_id: 10 },
            include: { channel: true, publication_fact: true } });
        const decision = await tx.artDirectionDecision.findFirst({ where: {
            id: 212, project_id: 10, content_item_id: 1029, source_content_revision: 3,
            channel: 'threads', placement: 'feed', decision: 'NO_VISUAL_NEEDED', status: 'active'
        } });
        const bodyHash = deps.hashBody(task?.draft_text || '');
        if (!task || task.channel_id !== 138 || task.channel?.type !== 'threads'
            || task.content_revision !== 3 || task.accepted_revision !== 3 || task.text_state !== 'accepted'
            || task.visual_placement !== 'feed' || task.visual_state !== 'NO_VISUAL_NEEDED'
            || task.selected_asset_id !== null || task.visual_decision_version !== decision?.decision_version
            || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
            || task.publication_mode !== 'approval_required'
            || task.schedule_at?.toISOString() !== args.expectedScheduleAt
            || bodyHash !== THREADS_1029_BODY_SHA256 || (task.draft_text?.length || 0) > 500
            || !decision || task.publication_fact || task.published_link) {
            throw new Error('[THREADS_1029_RELEASE_GUARD_FAILED]');
        }
        const attempt = await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1029 } });
        if (attempt) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        const changed = await tx.contentItem.updateMany({ where: {
            id: 1029, project_id: 10, channel_id: 138, content_revision: 3, accepted_revision: 3,
            text_state: 'accepted', visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED',
            visual_decision_version: decision.decision_version, selected_asset_id: null,
            status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
            schedule_at: new Date(args.expectedScheduleAt)
        }, data: { publication_mode: 'owner_released' } });
        if (changed.count !== 1) throw new Error('[THREADS_1029_RELEASE_CAS_CONFLICT]');
        const result = { task_id: 1029, channel_id: 138, content_revision: 3, accepted_revision: 3,
            body_sha256: bodyHash, visual_decision_id: 212, schedule_at: args.expectedScheduleAt,
            publication_mode: 'owner_released', explicit_send_required: true, published: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1029,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, publication_mode: 'approval_required',
                approval_reference: args.approvalReference }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type Task969Reschedule = {
    projectId: number; actorId: string; taskId: number;
    expectedScheduleAt: string; newScheduleAt: string;
    expectedBodySha256: string; expectedSelectedAssetId: number;
    approvalReference: string; idempotencyKey: string;
};

export type OwnerReleasedScheduleCorrection = {
    projectId: number; actorId: string; taskId: number; expectedChannelId: number;
    expectedContentRevision: number; expectedAcceptedRevision: number;
    expectedSelectedAssetId: number | null; expectedVisualMode: string; expectedVisualState: string;
    expectedPlacement: 'feed' | 'story'; expectedScheduleAt: string; expectedPublishAt: string;
    newScheduleAt: string; newPublishAt: string; expectedBodySha256: string;
    expectedManifestChecksum: string; correctionReference: string; idempotencyKey: string;
};

function requestHash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function releaseThreadsTask966(deps: Dependencies, args: Threads966Release) {
    if (args.projectId !== 10 || args.taskId !== 966 || args.expectedChannelId !== 138
        || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
        || args.expectedBodySha256 !== THREADS_966_BODY_SHA256) {
        throw new Error('[THREADS_966_SCOPE_MISMATCH] Exact task/revision/body required');
    }
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    const hash = requestHash(args);
    return deps.db.$transaction(async (tx: any) => {
        const project = await tx.project.findUnique({ where: { id: 10 }, select: { slug: true } });
        if (project?.slug !== 'analystcraft-2') throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
        await deps.requireOwner(tx, 10, args.actorId);
        const command = 'ba_release_approved_threads_task966';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior) {
            if (prior.before_state?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return prior.after_state;
        }
        const task = await tx.contentItem.findFirst({ where: { id: 966, project_id: 10 },
            include: { channel: true, publication_fact: true } });
        const decision = await tx.artDirectionDecision.findFirst({ where: {
            id: 142, project_id: 10, content_item_id: 966, source_content_revision: 1,
            channel: 'innokenty_threads', placement: 'feed', decision: 'NO_VISUAL_NEEDED', status: 'active'
        } });
        const bodyHash = deps.hashBody(task?.draft_text || '');
        if (!task || task.channel_id !== 138 || task.channel?.type !== 'threads'
            || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
            || task.visual_placement !== 'feed' || task.visual_state !== 'NO_VISUAL_NEEDED'
            || task.selected_asset_id !== null || task.visual_decision_version !== decision?.decision_version
            || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
            || task.publication_mode !== 'approval_required'
            || task.schedule_at?.toISOString() !== args.expectedScheduleAt
            || bodyHash !== THREADS_966_BODY_SHA256 || (task.draft_text?.length || 0) > 500
            || !decision || task.publication_fact || task.published_link) {
            throw new Error('[THREADS_966_RELEASE_GUARD_FAILED]');
        }
        const attempt = await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 966 } });
        if (attempt) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        const changed = await tx.contentItem.updateMany({ where: {
            id: 966, project_id: 10, channel_id: 138, content_revision: 1, accepted_revision: 1,
            text_state: 'accepted', visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED',
            visual_decision_version: decision.decision_version, selected_asset_id: null,
            status: 'ready_for_execution', handoff_state: 'ready',
            publication_mode: 'approval_required', schedule_at: new Date(args.expectedScheduleAt)
        }, data: { publication_mode: 'owner_released' } });
        if (changed.count !== 1) throw new Error('[THREADS_966_RELEASE_CAS_CONFLICT]');
        const result = { task_id: 966, channel_id: 138, content_revision: 1,
            accepted_revision: 1, body_sha256: bodyHash, visual_decision_id: 142,
            schedule_at: args.expectedScheduleAt, publication_mode: 'owner_released',
            explicit_send_required: true, published: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 966,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, publication_mode: 'approval_required',
                approval_reference: args.approvalReference }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function rescheduleOwnerReleasedTask969(deps: Dependencies, args: Task969Reschedule) {
    if (args.projectId !== 10 || args.taskId !== 969 || args.expectedSelectedAssetId !== 88
        || args.expectedBodySha256 !== TASK_969_BODY_SHA256) {
        throw new Error('[TASK_969_RESCHEDULE_SCOPE_MISMATCH] Exact task/body/asset required');
    }
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    const newSchedule = new Date(args.newScheduleAt);
    const now = Date.now();
    if (!Number.isFinite(newSchedule.getTime()) || newSchedule.getTime() < now - 5 * 60_000
        || newSchedule.getTime() > now + 30 * 60_000) {
        throw new Error('[TASK_969_SCHEDULE_WINDOW_MISMATCH] New schedule must be near the current time');
    }
    const hash = requestHash(args);
    return deps.db.$transaction(async (tx: any) => {
        await deps.requireOwner(tx, 10, args.actorId);
        const command = 'ba_reschedule_owner_released_task969';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior) {
            if (prior.before_state?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return prior.after_state;
        }
        const task = await tx.contentItem.findFirst({ where: { id: 969, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const bodyHash = deps.hashBody(task?.draft_text || '');
        if (!task || task.channel_id !== 111 || task.channel?.type !== 'telegram'
            || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
            || task.visual_placement !== 'feed' || task.visual_state !== 'APPROVED'
            || task.selected_asset_id !== 88 || task.selected_asset?.status !== 'approved'
            || task.selected_asset?.content_revision !== 1 || !task.selected_asset?.file_url
            || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
            || task.publication_mode !== 'owner_released'
            || task.schedule_at?.toISOString() !== args.expectedScheduleAt
            || bodyHash !== TASK_969_BODY_SHA256 || task.publication_fact || task.published_link) {
            throw new Error('[TASK_969_RESCHEDULE_GUARD_FAILED]');
        }
        const attempt = await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 969 } });
        if (attempt) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        const changed = await tx.contentItem.updateMany({ where: {
            id: 969, project_id: 10, channel_id: 111, content_revision: 1, accepted_revision: 1,
            text_state: 'accepted', visual_placement: 'feed', visual_state: 'APPROVED', selected_asset_id: 88,
            status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
            schedule_at: new Date(args.expectedScheduleAt)
        }, data: { schedule_at: newSchedule } });
        if (changed.count !== 1) throw new Error('[TASK_969_RESCHEDULE_CAS_CONFLICT]');
        const releaseProof = { task_id: 969, channel_id: 111, content_revision: 1,
            accepted_revision: 1, schedule_at: newSchedule.toISOString(), body_sha256: bodyHash,
            placement: 'feed', publication_mode: 'owner_released', explicit_send_required: true, published: false };
        const result = { ...releaseProof, previous_schedule_at: args.expectedScheduleAt,
            selected_asset_id: 88, owner_release_refreshed: true };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 969,
            actor_id: args.actorId, command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, schedule_at: args.expectedScheduleAt,
                approval_reference: args.approvalReference }, after_state: result } });
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 969,
            actor_id: args.actorId, command: 'ba_release_approved_telegram_task',
            idempotency_key: `${args.idempotencyKey}:release`,
            before_state: { request_hash: hash, publication_mode: 'owner_released',
                schedule_at: args.expectedScheduleAt, approval_reference: args.approvalReference,
                refreshed_by: command }, after_state: releaseProof } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Supersedes one exact owner-release proof before correcting its schedule.
 * The task returns to approval_required so a fresh owner release is always explicit.
 */
export async function correctOwnerReleasedTaskSchedule(
    deps: Dependencies,
    args: OwnerReleasedScheduleCorrection
) {
    if (!args.correctionReference.trim()) throw new Error('[OWNER_CORRECTION_REFERENCE_REQUIRED]');
    if (!args.expectedManifestChecksum.match(/^sha256:[a-f0-9]{64}$/i)) throw new Error('[INVALID_MANIFEST_CHECKSUM]');
    const oldSchedule = new Date(args.expectedScheduleAt);
    const oldPublishAt = new Date(args.expectedPublishAt);
    const newSchedule = new Date(args.newScheduleAt);
    const newPublishAt = new Date(args.newPublishAt);
    if ([oldSchedule, oldPublishAt, newSchedule, newPublishAt].some(value => !Number.isFinite(value.getTime()))) {
        throw new Error('[INVALID_SCHEDULE]');
    }
    const hash = requestHash(args);
    return deps.db.$transaction(async (tx: any) => {
        await deps.requireOwner(tx, args.projectId, args.actorId);
        const checksum = await deps.getManifestChecksum?.(args.projectId, args.actorId);
        if (!checksum || checksum !== args.expectedManifestChecksum) throw new Error('[STALE_MANIFEST] Workspace manifest changed');
        const command = 'ba_correct_owner_released_task_schedule';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior) {
            if (prior.before_state?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return prior.after_state;
        }
        const task = await tx.contentItem.findFirst({ where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        const bodyHash = deps.hashBody(task?.draft_text || '');
        if (!task || task.channel_id !== args.expectedChannelId || task.channel?.type !== 'telegram'
            || task.content_revision !== args.expectedContentRevision
            || task.accepted_revision !== args.expectedAcceptedRevision
            || task.content_revision !== task.accepted_revision || task.text_state !== 'accepted'
            || task.visual_mode !== args.expectedVisualMode || task.visual_state !== args.expectedVisualState
            || task.visual_placement !== args.expectedPlacement
            || task.selected_asset_id !== args.expectedSelectedAssetId
            || (args.expectedSelectedAssetId !== null && (task.selected_asset?.status !== 'approved'
                || task.selected_asset?.content_revision !== args.expectedContentRevision || !task.selected_asset?.file_url))
            || task.status !== 'ready_for_execution' || task.handoff_state !== 'ready'
            || task.publication_mode !== 'owner_released'
            || task.schedule_at?.toISOString() !== args.expectedScheduleAt
            || task.publish_at?.toISOString() !== args.expectedPublishAt
            || bodyHash !== args.expectedBodySha256 || task.publication_fact || task.published_link) {
            throw new Error('[SCHEDULE_CORRECTION_GUARD_FAILED] Exact released task state is required');
        }
        const release = await tx.workflowEvent.findFirst({ where: {
            project_id: args.projectId, content_item_id: args.taskId,
            command: 'ba_release_approved_telegram_task'
        }, orderBy: { id: 'desc' } });
        const proof = release?.after_state;
        if (!proof || proof.task_id !== args.taskId || proof.channel_id !== args.expectedChannelId
            || proof.content_revision !== args.expectedContentRevision
            || proof.accepted_revision !== args.expectedAcceptedRevision
            || proof.schedule_at !== args.expectedScheduleAt || proof.body_sha256 !== args.expectedBodySha256
            || proof.placement !== args.expectedPlacement || proof.publication_mode !== 'owner_released') {
            throw new Error('[OWNER_RELEASE_PROOF_MISMATCH] Current release proof does not match task');
        }
        const attempt = await tx.deliveryAttempt.findFirst({ where: {
            project_id: args.projectId, content_item_id: args.taskId
        } });
        if (attempt) throw new Error('[DELIVERY_ATTEMPT_EXISTS] Existing attempt requires reconciliation');
        const checksumBeforeCas = await deps.getManifestChecksum?.(args.projectId, args.actorId);
        if (checksumBeforeCas !== args.expectedManifestChecksum) {
            throw new Error('[STALE_MANIFEST] Workspace manifest changed before correction');
        }
        const changed = await tx.contentItem.updateMany({ where: {
            id: args.taskId, project_id: args.projectId, channel_id: args.expectedChannelId,
            content_revision: args.expectedContentRevision, accepted_revision: args.expectedAcceptedRevision,
            text_state: 'accepted', visual_mode: args.expectedVisualMode, visual_state: args.expectedVisualState,
            visual_placement: args.expectedPlacement, selected_asset_id: args.expectedSelectedAssetId,
            status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
            schedule_at: oldSchedule, publish_at: oldPublishAt
        }, data: { schedule_at: newSchedule, publish_at: newPublishAt, publication_mode: 'approval_required' } });
        if (changed.count !== 1) throw new Error('[SCHEDULE_CORRECTION_CAS_CONFLICT] Task changed during correction');
        const result = {
            task_id: args.taskId, project_id: args.projectId, channel_id: args.expectedChannelId,
            content_revision: args.expectedContentRevision, accepted_revision: args.expectedAcceptedRevision,
            selected_asset_id: args.expectedSelectedAssetId, body_sha256: bodyHash,
            previous_schedule_at: args.expectedScheduleAt, schedule_at: newSchedule.toISOString(),
            previous_publish_at: args.expectedPublishAt, publish_at: newPublishAt.toISOString(),
            publication_mode: 'approval_required', release_superseded: true,
            fresh_owner_release_required: true, published: false
        };
        await tx.workflowEvent.create({ data: {
            project_id: args.projectId, content_item_id: args.taskId, actor_id: args.actorId,
            command, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, manifest_checksum: checksum,
                approval_reference: args.correctionReference, superseded_release_event_id: release.id,
                schedule_at: args.expectedScheduleAt, publish_at: args.expectedPublishAt,
                publication_mode: 'owner_released' },
            after_state: result
        } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
