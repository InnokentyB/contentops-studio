import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db';
import { buildGeneratedContentItemHandoff } from './publication_plan/handoff';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const checksum = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewHandoffRepairSchema = z.object({
    projectId: z.number().int().positive(), taskId: z.number().int().positive(),
    workItemId: z.number().int().positive(), actorId: z.string().regex(/^user:\d+$/),
    expectedChannelId: z.number().int().positive(), expectedRevision: z.number().int().positive(),
    expectedBodySha256: checksum, expectedChannelConfigSha256: checksum,
    expectedTaskMetadataSha256: checksum, expectedReviewStateSha256: checksum,
    expectedScheduleAt: z.string().datetime(), expectedPublishAt: z.string().datetime(),
    expectedResultVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(160), reason: z.string().min(10).max(1000),
    apply: z.boolean().default(false)
}).strict();
type Args = z.input<typeof reviewHandoffRepairSchema>;
type Db = Pick<Prisma.TransactionClient, 'projectMember' | 'contentItem' | 'workItem'
    | 'approvalDecision' | 'deliveryAttempt' | 'workflowEvent'>;
const COMMAND = 'ba_repair_content_review_handoff';
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
export function reviewRepairMetadataHash(task: { assets?: unknown; quality_report?: unknown; metrics?: unknown;
    visual_mode?: unknown; visual_state?: unknown; visual_decision_version?: unknown; selected_asset_id?: unknown }) {
    return hash(JSON.stringify({ assets: task.assets ?? null, quality_report: task.quality_report ?? null,
        metrics: task.metrics ?? null, visual_mode: task.visual_mode ?? null,
        visual_state: task.visual_state ?? null, visual_decision_version: task.visual_decision_version ?? null,
        selected_asset_id: task.selected_asset_id ?? null }));
}
export function reviewRepairStateHash(review: { result_payload?: unknown; note?: unknown; reason_code?: unknown;
    input_context_version?: unknown; result_version?: unknown; lease_expires_at?: unknown }) {
    return hash(JSON.stringify({ result_payload: review.result_payload ?? null, note: review.note ?? null,
        reason_code: review.reason_code ?? null, input_context_version: review.input_context_version,
        result_version: review.result_version, lease_expires_at: review.lease_expires_at ?? null }));
}
async function assertOwner(db: Db, args: Args) {
    const owner = await db.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: args.projectId, user_id: Number(args.actorId.slice(5)) } } });
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
}
async function exactState(db: Db, args: Args) {
    const [task, review, approval, attempts, competing] = await Promise.all([
        db.contentItem.findFirst({ where: { id: args.taskId, project_id: args.projectId },
            include: { channel: true, publication_fact: true } }),
        db.workItem.findFirst({ where: { id: args.workItemId, project_id: args.projectId,
            content_item_id: args.taskId } }),
        db.approvalDecision.findUnique({ where: { work_item_id_result_version: {
            work_item_id: args.workItemId, result_version: args.expectedResultVersion } } }),
        db.deliveryAttempt.count({ where: { project_id: args.projectId, content_item_id: args.taskId } }),
        db.workItem.count({ where: { project_id: args.projectId, content_item_id: args.taskId,
            id: { not: args.workItemId }, kind: 'content_review',
            state: { in: ['pending', 'available', 'claimed', 'waiting_approval'] } } })
    ]);
    if (!task || task.project_id !== args.projectId || task.channel_id !== args.expectedChannelId
        || !task.channel || task.channel.project_id !== args.projectId || task.channel.id !== args.expectedChannelId
        || task.content_revision !== args.expectedRevision || task.accepted_revision !== null
        || task.status !== 'drafted' || task.text_state !== 'draft' || task.visual_state !== 'STALE'
        || task.publication_mode !== 'approval_required' || task.selected_asset_id !== null
        || hash(task.draft_text || '') !== args.expectedBodySha256
        || hash(JSON.stringify(task.channel.config)) !== args.expectedChannelConfigSha256
        || reviewRepairMetadataHash(task) !== args.expectedTaskMetadataSha256
        || task.schedule_at?.toISOString() !== args.expectedScheduleAt
        || task.publish_at?.toISOString() !== args.expectedPublishAt
        || task.publication_fact || task.published_link || attempts || competing
        || !review || review.project_id !== args.projectId || review.content_item_id !== args.taskId
        || review.kind !== 'content_review' || review.assignee_role !== 'content_reviewer'
        || review.state !== 'waiting_approval' || review.input_context_version !== args.expectedRevision
        || review.result_version !== args.expectedResultVersion || review.lease_actor_id || review.lease_token
        || reviewRepairStateHash(review) !== args.expectedReviewStateSha256
        || record(review.result_payload).content_revision !== args.expectedRevision
        || !approval || approval.decision !== 'approved') {
        throw new Error('[REVIEW_HANDOFF_SNAPSHOT_CHANGED]');
    }
    const bundle = buildGeneratedContentItemHandoff(task);
    if (bundle.mode !== 'manual' || bundle.transport.connector_authority !== 'manual_only') {
        throw new Error('[MANUAL_ONLY_CHANNEL_REQUIRED]');
    }
    return { task, review, approval, bundle };
}

/** Owner-only metadata/review recovery. No acceptance, art decision or publication authority. */
export async function repairReviewHandoff(input: Args, database: typeof prisma = prisma) {
    const args = reviewHandoffRepairSchema.parse(input);
    const { apply, ...binding } = args;
    const requestHash = hash(JSON.stringify(binding));
    const key = { project_id_actor_id_command_idempotency_key: { project_id: args.projectId,
        actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey } };
    const replay = async (db: Db) => {
        await assertOwner(db, args);
        const event = await db.workflowEvent.findUnique({ where: key });
        if (!event) return null;
        if (record(event.before_state).request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
        return { ...record(event.after_state), audit_id: event.id, replayed: true };
    };
    const prior = await replay(database);
    if (prior) return prior;
    const current = await exactState(database, args);
    const preview = { project_id: args.projectId, task_id: args.taskId,
        superseded_work_item_id: args.workItemId, historical_approval_id: current.approval.id,
        replacement_input_context_version: args.expectedRevision, replacement_result_version: 0,
        handoff_mode: 'manual', connector_authority: 'manual_only',
        preserved_body_sha256: args.expectedBodySha256, publication_authorized: false,
        delivery_attempt_count: 0, publication_fact: null };
    if (!apply) return { mode: 'preview', ...preview };
    return database.$transaction(async tx => {
        const repeated = await replay(tx);
        if (repeated) return repeated;
        const state = await exactState(tx, args);
        const superseded = await tx.workItem.updateMany({ where: {
            id: args.workItemId, project_id: args.projectId, content_item_id: args.taskId,
            kind: 'content_review', state: 'waiting_approval', input_context_version: args.expectedRevision,
            result_version: args.expectedResultVersion, lease_actor_id: null, lease_token: null },
        data: { state: 'completed' } });
        if (superseded.count !== 1) throw new Error('[REVIEW_HANDOFF_CAS_CONFLICT]');
        const replacement = await tx.workItem.create({ data: { project_id: args.projectId,
            content_item_id: args.taskId, week_package_id: state.review.week_package_id,
            item_key: state.review.item_key, kind: 'content_review', state: 'available',
            assignee_role: 'content_reviewer', input_context_version: args.expectedRevision,
            result_version: 0, due_at: state.review.due_at,
            dedupe_key: `review-recovery:${args.projectId}:${args.taskId}:${args.workItemId}:${args.expectedRevision}`,
            note: `Replaces WI${args.workItemId}; historical approval ${state.approval.id} retained` } });
        const quality = { ...record(state.task.quality_report), handoff_bundle: state.bundle };
        const changed = await tx.contentItem.updateMany({ where: { id: args.taskId, project_id: args.projectId,
            channel_id: args.expectedChannelId, content_revision: args.expectedRevision,
            accepted_revision: null, status: 'drafted', publication_mode: 'approval_required',
            quality_report: { equals: state.task.quality_report ?? Prisma.JsonNull } },
        data: { quality_report: quality as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new Error('[REVIEW_HANDOFF_CAS_CONFLICT]');
        const result = { mode: 'applied', ...preview, replacement_work_item_id: replacement.id, replayed: false };
        const event = await tx.workflowEvent.create({ data: { project_id: args.projectId,
            content_item_id: args.taskId, work_item_id: replacement.id, actor_id: args.actorId,
            command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, review_id: args.workItemId,
                approval_id: state.approval.id, body_sha256: args.expectedBodySha256,
                channel_config_sha256: args.expectedChannelConfigSha256,
                task_metadata_sha256: args.expectedTaskMetadataSha256,
                review_state_sha256: args.expectedReviewStateSha256,
                previous_review_note: state.review.note, previous_reason_code: state.review.reason_code,
                old_handoff_mode: record(record(state.task.quality_report).handoff_bundle).mode ?? null,
                reason: args.reason }, after_state: result } });
        return { ...result, audit_id: event.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
