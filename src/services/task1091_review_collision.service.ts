import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';

export const TASK1091_BODY_SHA256 = 'd4301764ab75882e461178972ce2958533e4d36d175e0bd94fccc3aaa91786c1';
export const TASK1091_REVIEW_REPAIR_KEY = 'repair-p10-task1091-review-collision-20261012-v1';
const COMMAND = 'ba_repair_task1091_review_collision';
const REPLACEMENT_DEDUPE_KEY = 'content-review-recovery:1091:2:1656';
const SCHEDULE = '2026-10-13T17:30:00.000Z';

export type Task1091ReviewRepairArgs = {
    projectId: 10;
    taskId: 1091;
    workItemId: 1656;
    actorId: string;
    expectedContentRevision: 2;
    expectedAcceptedRevision: null;
    expectedBodySha256: typeof TASK1091_BODY_SHA256;
    expectedScheduleAt: typeof SCHEDULE;
    expectedResultVersion: 2;
    expectedInputContextVersion: 2;
    idempotencyKey: typeof TASK1091_REVIEW_REPAIR_KEY;
    reason: string;
    confirm: boolean;
};

type Dependencies = { database: typeof prisma };
const dependencies: Dependencies = { database: prisma };

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function assertScope(args: Task1091ReviewRepairArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1091 || args.workItemId !== 1656
        || args.expectedContentRevision !== 2 || args.expectedAcceptedRevision !== null
        || args.expectedBodySha256 !== TASK1091_BODY_SHA256 || args.expectedScheduleAt !== SCHEDULE
        || args.expectedResultVersion !== 2 || args.expectedInputContextVersion !== 2
        || args.idempotencyKey !== TASK1091_REVIEW_REPAIR_KEY || !args.reason.trim()) {
        throw new Error('[TASK1091_REVIEW_REPAIR_SCOPE_MISMATCH]');
    }
    return Number(actor[1]);
}

async function loadExactState(database: typeof prisma) {
    const [task, review, approval, artDecision, attemptCount] = await Promise.all([
        database.contentItem.findFirst({ where: { id: 1091, project_id: 10 },
            include: { publication_fact: true } }),
        database.workItem.findFirst({ where: { id: 1656, project_id: 10, content_item_id: 1091 } }),
        database.approvalDecision.findUnique({ where: { work_item_id_result_version: {
            work_item_id: 1656, result_version: 2 } } }),
        database.artDirectionDecision.findFirst({ where: { id: 260, project_id: 10,
            content_item_id: 1091 } }),
        database.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1091 } })
    ]);
    const payload = object(review?.result_payload);
    if (!task || task.status !== 'drafted' || task.content_revision !== 2
        || task.accepted_revision !== null || task.text_state !== 'draft'
        || task.channel_id !== 108 || task.publication_mode !== 'approval_required'
        || createHash('sha256').update(task.draft_text || '').digest('hex') !== TASK1091_BODY_SHA256
        || task.schedule_at?.toISOString() !== SCHEDULE || task.publication_fact || task.published_link
        || task.selected_asset_id !== null || task.visual_state !== 'STALE'
        || task.visual_mode !== 'auto_assess' || task.visual_placement !== 'feed'
        || task.visual_decision_version !== 1 || attemptCount !== 0
        || !review || review.kind !== 'content_review' || review.assignee_role !== 'content_reviewer'
        || review.state !== 'waiting_approval' || review.input_context_version !== 2
        || review.result_version !== 2 || review.content_item_id !== 1091
        || review.due_at?.toISOString() !== SCHEDULE || review.lease_token || review.lease_actor_id
        || payload.content_revision !== 2
        || !approval || approval.decision !== 'approved' || approval.result_version !== 2
        || !artDecision || artDecision.source_content_revision !== 1
        || artDecision.decision !== 'NO_VISUAL_NEEDED') {
        throw new Error('[TASK1091_REVIEW_REPAIR_GUARD_FAILED] Exact review collision state changed');
    }
    return { task, review, approval, artDecision };
}

function preview(state: Awaited<ReturnType<typeof loadExactState>>) {
    return {
        project_id: 10,
        task_id: 1091,
        changed_fields: {
            superseded_review: { id: 1656, state: { from: 'waiting_approval', to: 'completed' } },
            replacement_review: { operation: 'create', state: 'available', input_context_version: 2,
                result_version: 2, dedupe_key: REPLACEMENT_DEDUPE_KEY }
        },
        preserved: {
            body_sha256: TASK1091_BODY_SHA256,
            content_revision: state.task.content_revision,
            accepted_revision: state.task.accepted_revision,
            schedule_at: state.task.schedule_at!.toISOString(),
            historical_approval_id: state.approval.id,
            historical_art_decision_id: state.artDecision.id,
            publication_fact: null,
            delivery_attempt_count: 0
        },
        release_or_publish_performed: false
    };
}

/** Exact, owner-authorized Editor repair for task 1091's historical review-version collision. */
export async function repairTask1091ReviewCollision(args: Task1091ReviewRepairArgs,
    deps: Dependencies = dependencies): Promise<Record<string, unknown>> {
    const userId = assertScope(args);
    const owner = await deps.database.projectMember.findUnique({ where: {
        project_id_user_id: { project_id: 10, user_id: userId } } });
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const existing = await deps.database.workflowEvent.findUnique({ where: {
        project_id_actor_id_command_idempotency_key: { project_id: 10, actor_id: args.actorId,
            command: COMMAND, idempotency_key: args.idempotencyKey } } });
    if (existing) return { ...object(existing.after_state), audit_id: existing.id, replayed: true };
    const current = await loadExactState(deps.database);
    const exactPreview = preview(current);
    if (!args.confirm) return { mode: 'preview', ...exactPreview };

    return deps.database.$transaction(async tx => {
        const replay = await tx.workflowEvent.findUnique({ where: {
            project_id_actor_id_command_idempotency_key: { project_id: 10, actor_id: args.actorId,
                command: COMMAND, idempotency_key: args.idempotencyKey } } });
        if (replay) return { ...object(replay.after_state), audit_id: replay.id, replayed: true };
        const state = await loadExactState(tx as typeof prisma);
        const changed = await tx.workItem.updateMany({ where: { id: 1656, project_id: 10,
            content_item_id: 1091, kind: 'content_review', state: 'waiting_approval',
            input_context_version: 2, result_version: 2, lease_token: null, lease_actor_id: null },
        data: { state: 'completed', note: 'Superseded after historical approval collision; task 1091 revision 2' } });
        if (changed.count !== 1) throw new Error('[TASK1091_REVIEW_REPAIR_CAS_CONFLICT]');
        const replacement = await tx.workItem.upsert({ where: { dedupe_key: REPLACEMENT_DEDUPE_KEY },
            update: {}, create: { project_id: 10, week_package_id: state.review.week_package_id,
                content_item_id: 1091, item_key: state.review.item_key, kind: 'content_review',
                state: 'available', assignee_role: 'content_reviewer', due_at: state.review.due_at,
                input_context_version: 2, result_version: 2, dedupe_key: REPLACEMENT_DEDUPE_KEY,
                note: args.reason } });
        const result = { mode: 'applied', ...preview(state), replacement_work_item_id: replacement.id,
            replayed: false };
        const audit = await tx.workflowEvent.create({ data: { project_id: 10,
            content_item_id: 1091, work_item_id: replacement.id, actor_id: args.actorId,
            command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: { review_id: 1656, review_state: state.review.state,
                review_result_version: state.review.result_version,
                review_input_context_version: state.review.input_context_version,
                approval_id: state.approval.id, approval_decision: state.approval.decision,
                art_decision_id: state.artDecision.id, reason: args.reason } as Prisma.InputJsonValue,
            after_state: result as Prisma.InputJsonValue } });
        return { ...result, audit_id: audit.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
