import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const TASK1091_REV4_BODY_SHA256 =
    'e9951a6c1b9c3dbe0a9415d91920da77f0c2c4b78c1b258c4123edb5e36e0004';
export const TASK1091_REV4_REVIEW_REPAIR_KEY =
    'repair-p10-task1091-rev4-review-collision-20261012-v1';
export const TASK1091_REV4_MANIFEST_CHECKSUM =
    'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b';

const COMMAND = 'ba_repair_task1091_rev4_review_collision';
const SCHEDULE = '2026-10-13T17:30:00.000Z';
const TITLE = 'Kun Chen: агентские тесты не доказывают правильность. Что это меняет для TDPD';
const ITEM_KEY = 'PORTFOLIO-OS-PERSONAL-TG-20261013-01';
const REPLACEMENT_DEDUPE_KEY = 'content-review-recovery:1091:4:1656-1866:20261012';

export type Task1091Rev4ReviewRepairArgs = {
    projectId: 10;
    taskId: 1091;
    collisionWorkItemId: 1656;
    staleWorkItemId: 1866;
    actorId: string;
    expectedManifestChecksum: typeof TASK1091_REV4_MANIFEST_CHECKSUM;
    expectedContentRevision: 4;
    expectedAcceptedRevision: null;
    expectedBodySha256: typeof TASK1091_REV4_BODY_SHA256;
    expectedChannelId: 108;
    expectedScheduleAt: typeof SCHEDULE;
    expectedCollisionInputContextVersion: 4;
    expectedCollisionResultVersion: 2;
    expectedStaleInputContextVersion: 3;
    expectedStaleResultVersion: 3;
    idempotencyKey: typeof TASK1091_REV4_REVIEW_REPAIR_KEY;
    reason: string;
    confirm: boolean;
};

type Dependencies = {
    database: typeof prisma;
    manifestLoader(projectId: number, userId: number): Promise<{ checksum: string }>;
    hashBody(body: string): string;
};

const dependencies: Dependencies = {
    database: prisma,
    manifestLoader: loadAgentWorkspaceManifest,
    hashBody: body => createHash('sha256').update(body).digest('hex')
};

function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function assertScope(args: Task1091Rev4ReviewRepairArgs): number {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1091
        || args.collisionWorkItemId !== 1656 || args.staleWorkItemId !== 1866
        || args.expectedManifestChecksum !== TASK1091_REV4_MANIFEST_CHECKSUM
        || args.expectedContentRevision !== 4 || args.expectedAcceptedRevision !== null
        || args.expectedBodySha256 !== TASK1091_REV4_BODY_SHA256
        || args.expectedChannelId !== 108 || args.expectedScheduleAt !== SCHEDULE
        || args.expectedCollisionInputContextVersion !== 4
        || args.expectedCollisionResultVersion !== 2
        || args.expectedStaleInputContextVersion !== 3
        || args.expectedStaleResultVersion !== 3
        || args.idempotencyKey !== TASK1091_REV4_REVIEW_REPAIR_KEY
        || !args.reason.trim()) {
        throw new Error('[TASK1091_REV4_REVIEW_REPAIR_SCOPE_MISMATCH]');
    }
    return Number(actor[1]);
}

async function loadExactState(database: typeof prisma, hashBody: (body: string) => string) {
    const [project, task, collision, collisionApproval, stale, staleApproval, activeReviewCount,
        attemptCount, releaseCount] = await Promise.all([
        database.project.findUnique({ where: { id: 10 } }),
        database.contentItem.findFirst({ where: { id: 1091, project_id: 10 },
            include: { publication_fact: true } }),
        database.workItem.findFirst({ where: { id: 1656, project_id: 10,
            content_item_id: 1091 } }),
        database.approvalDecision.findUnique({ where: { work_item_id_result_version: {
            work_item_id: 1656, result_version: 2 } } }),
        database.workItem.findFirst({ where: { id: 1866, project_id: 10,
            content_item_id: 1091 } }),
        database.approvalDecision.findUnique({ where: { work_item_id_result_version: {
            work_item_id: 1866, result_version: 3 } } }),
        database.workItem.count({ where: { project_id: 10, content_item_id: 1091,
            kind: 'content_review', state: { in: ['pending', 'available', 'claimed',
                'waiting_approval', 'blocked'] } } }),
        database.deliveryAttempt.count({ where: { project_id: 10, content_item_id: 1091 } }),
        database.workflowEvent.count({ where: { project_id: 10, content_item_id: 1091,
            command: { contains: 'release' } } })
    ]);
    const stalePayload = object(stale?.result_payload);
    if (!project || project.slug !== 'analystcraft-2' || !task || task.title !== TITLE
        || task.item_key !== ITEM_KEY || task.status !== 'drafted' || task.content_revision !== 4
        || task.accepted_revision !== null || task.text_state !== 'draft'
        || hashBody(task.draft_text || '') !== TASK1091_REV4_BODY_SHA256
        || task.channel_id !== 108 || task.schedule_at?.toISOString() !== SCHEDULE
        || task.publish_at?.toISOString() !== SCHEDULE
        || task.publication_mode !== 'approval_required' || task.publication_fact
        || task.published_link || task.selected_asset_id !== null || task.visual_state !== 'STALE'
        || task.visual_mode !== 'auto_assess' || task.visual_placement !== 'feed'
        || task.visual_decision_version !== 2 || task.handoff_state !== 'blocked'
        || attemptCount !== 0 || releaseCount !== 0 || activeReviewCount !== 2
        || !collision || collision.kind !== 'content_review'
        || collision.assignee_role !== 'content_reviewer' || collision.state !== 'available'
        || collision.input_context_version !== 4 || collision.result_version !== 2
        || collision.result_payload !== null || collision.due_at?.toISOString() !== SCHEDULE
        || collision.lease_token || collision.lease_actor_id
        || !collisionApproval || collisionApproval.id !== 301
        || collisionApproval.result_version !== 2 || collisionApproval.decision !== 'approved'
        || !stale || stale.kind !== 'content_review' || stale.assignee_role !== 'content_reviewer'
        || stale.state !== 'waiting_approval' || stale.input_context_version !== 3
        || stale.result_version !== 3 || stale.due_at?.toISOString() !== SCHEDULE
        || stale.lease_token || stale.lease_actor_id || stalePayload.content_revision !== 3
        || hashBody(String(stalePayload.body || '')) !== TASK1091_REV4_BODY_SHA256
        || !staleApproval || staleApproval.id !== 345 || staleApproval.result_version !== 3
        || staleApproval.decision !== 'approved') {
        throw new Error('[TASK1091_REV4_REVIEW_REPAIR_GUARD_FAILED] Exact review state changed');
    }
    return { task, collision, collisionApproval, stale, staleApproval };
}

function preview(state: Awaited<ReturnType<typeof loadExactState>>) {
    return {
        project_id: 10,
        task_id: 1091,
        changed_fields: {
            collision_review: { id: 1656, state: { from: 'available', to: 'completed' },
                input_context_version: 4, result_version: 2,
                existing_approval_decision_id: state.collisionApproval.id },
            stale_review: { id: 1866, state: { from: 'waiting_approval', to: 'completed' },
                input_context_version: 3, result_version: 3,
                existing_approval_decision_id: state.staleApproval.id },
            replacement_review: { operation: 'create', state: 'available',
                input_context_version: 4, result_version: 4,
                dedupe_key: REPLACEMENT_DEDUPE_KEY }
        },
        preserved: {
            body_sha256: TASK1091_REV4_BODY_SHA256,
            content_revision: 4,
            accepted_revision: null,
            channel_id: 108,
            schedule_at: SCHEDULE,
            publication_mode: 'approval_required',
            publication_fact: null,
            delivery_attempt_count: 0,
            release_event_count: 0
        },
        collision_prevention: {
            prior_approval_pairs: ['1656:2', '1866:3'],
            replacement_result_version: 4,
            fresh_work_item_required: true
        },
        release_or_publish_performed: false
    };
}

/** Owner-authorized, Editor-only recovery for task 1091's revision-4 review collision. */
export async function repairTask1091Rev4ReviewCollision(args: Task1091Rev4ReviewRepairArgs,
    deps: Dependencies = dependencies): Promise<Record<string, unknown>> {
    const userId = assertScope(args);
    const [owner, manifest, existing] = await Promise.all([
        deps.database.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: 10, user_id: userId } } }),
        deps.manifestLoader(10, userId),
        deps.database.workflowEvent.findUnique({ where: {
            project_id_actor_id_command_idempotency_key: { project_id: 10,
                actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey }
        } })
    ]);
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== TASK1091_REV4_MANIFEST_CHECKSUM) {
        throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
    }
    if (existing) return { ...object(existing.after_state), audit_id: existing.id, replayed: true };
    const current = await loadExactState(deps.database, deps.hashBody);
    if (!args.confirm) return { mode: 'preview', ...preview(current) };

    return deps.database.$transaction(async tx => {
        const replay = await tx.workflowEvent.findUnique({ where: {
            project_id_actor_id_command_idempotency_key: { project_id: 10,
                actor_id: args.actorId, command: COMMAND, idempotency_key: args.idempotencyKey }
        } });
        if (replay) return { ...object(replay.after_state), audit_id: replay.id, replayed: true };
        const state = await loadExactState(tx as typeof prisma, deps.hashBody);
        const [collisionChanged, staleChanged] = await Promise.all([
            tx.workItem.updateMany({ where: { id: 1656, project_id: 10,
                content_item_id: 1091, kind: 'content_review', state: 'available',
                input_context_version: 4, result_version: 2, result_payload: { equals: Prisma.DbNull },
                lease_token: null, lease_actor_id: null }, data: { state: 'completed',
                note: 'Superseded: result version 2 already has approval decision 301; task is revision 4' } }),
            tx.workItem.updateMany({ where: { id: 1866, project_id: 10,
                content_item_id: 1091, kind: 'content_review', state: 'waiting_approval',
                input_context_version: 3, result_version: 3, lease_token: null,
                lease_actor_id: null }, data: { state: 'completed',
                note: 'Superseded: review and approval are bound to stale content revision 3' } })
        ]);
        if (collisionChanged.count !== 1 || staleChanged.count !== 1) {
            throw new Error('[TASK1091_REV4_REVIEW_REPAIR_CAS_CONFLICT]');
        }
        const replacement = await tx.workItem.upsert({ where: { dedupe_key: REPLACEMENT_DEDUPE_KEY },
            update: {}, create: { project_id: 10, week_package_id: state.collision.week_package_id,
                content_item_id: 1091, item_key: ITEM_KEY, kind: 'content_review',
                state: 'available', assignee_role: 'content_reviewer', due_at: state.task.schedule_at,
                input_context_version: 4, result_version: 4, dedupe_key: REPLACEMENT_DEDUPE_KEY,
                note: args.reason } });
        const result = { mode: 'applied', ...preview(state),
            replacement_work_item_id: replacement.id, replayed: false };
        const beforeState: Prisma.InputJsonValue = {
            collision_review_id: 1656,
            collision_approval_id: 301,
            stale_review_id: 1866,
            stale_approval_id: 345,
            reason: args.reason
        };
        const audit = await tx.workflowEvent.create({ data: { project_id: 10,
            content_item_id: 1091, work_item_id: replacement.id, actor_id: args.actorId,
            command: COMMAND, idempotency_key: args.idempotencyKey,
            before_state: beforeState,
            after_state: result as Prisma.InputJsonValue } });
        return { ...result, audit_id: audit.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
