import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

const THREADS_966_BODY_SHA256 = '83dd0fe0b2b354898b9fd3e5161d5ab05517c4c2b2304862d74c949ce1e2b123';
const TASK_969_BODY_SHA256 = '43cff698cbb2597144a5fd696013b361961cd9d7c824809d6c4279d45391d1e9';

type Dependencies = {
    db: any;
    hashBody: (body: string) => string;
    requireOwner: (tx: any, projectId: number, actorId: string) => Promise<void>;
};

export type Threads966Release = {
    projectId: number; actorId: string; taskId: number; expectedChannelId: number;
    expectedContentRevision: number; expectedAcceptedRevision: number;
    expectedScheduleAt: string; expectedBodySha256: string;
    approvalReference: string; idempotencyKey: string;
};

export type Task969Reschedule = {
    projectId: number; actorId: string; taskId: number;
    expectedScheduleAt: string; newScheduleAt: string;
    expectedBodySha256: string; expectedSelectedAssetId: number;
    approvalReference: string; idempotencyKey: string;
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
