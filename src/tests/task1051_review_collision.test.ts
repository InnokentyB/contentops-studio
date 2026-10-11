import test from 'node:test';
import assert from 'node:assert/strict';
import {
    repairTask1051ReviewCollision,
    TASK1051_BODY_SHA256,
    TASK1051_REVIEW_REPAIR_KEY
} from '../services/task1051_review_collision.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const body = `Yesterday I had a Threads post ready to publish. The copy was approved, but the attached visual no longer matched the decision.

The easy fix was to detach the image and press send.

I didn't.

I restored the text-only version as a new revision, ran review again, created a fresh release, and published that exact package once.

It took a few extra minutes. It left a clean answer to a question that matters later: what exactly did we approve?

Manual fixes are fast until you need an audit trail.`;

const args = { projectId: 10, taskId: 1051, workItemId: 1731, actorId: 'user:2',
    expectedContentRevision: 2, expectedAcceptedRevision: null,
    expectedBodySha256: TASK1051_BODY_SHA256, expectedScheduleAt: '2026-10-11T16:30:00.000Z',
    expectedResultVersion: 2, expectedInputContextVersion: 2,
    idempotencyKey: TASK1051_REVIEW_REPAIR_KEY,
    reason: 'Owner-authorized exact task 1051 review collision recovery', confirm: false } as const;

function fixture(options: { taskId?: number; reviewState?: string; attemptCount?: number } = {}) {
    const task = { id: options.taskId ?? 1051, project_id: 10, status: 'drafted',
        content_revision: 2, accepted_revision: null, text_state: 'draft', draft_text: body,
        schedule_at: new Date('2026-10-11T16:30:00.000Z'), publication_fact: null,
        published_link: null, selected_asset_id: null, visual_state: 'STALE', visual_decision_version: 1 };
    const review = { id: 1731, project_id: 10, content_item_id: 1051, week_package_id: null,
        item_key: 'W41-ALLOC-2026-ROW-30', kind: 'content_review',
        state: options.reviewState ?? 'waiting_approval', assignee_role: 'content_reviewer',
        due_at: new Date('2026-10-11T16:30:00.000Z'), input_context_version: 2,
        result_version: 2, result_payload: { recommendation: 'approve', content_revision: 2 },
        lease_token: null, lease_actor_id: null };
    const approval = { id: 611, work_item_id: 1731, result_version: 2, decision: 'approved' };
    const artDecision = { id: 278, project_id: 10, content_item_id: 1051,
        source_content_revision: 1, decision: 'NO_VISUAL_NEEDED' };
    const events: Array<{ id: number; actor_id: string; command: string; idempotency_key: string;
        after_state: unknown }> = [];
    const replacements: Array<Record<string, unknown>> = [];
    let writes = 0;
    const database = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => task },
        workItem: {
            findFirst: async () => review,
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                if (review.state !== where.state) return { count: 0 };
                writes++; Object.assign(review, data); return { count: 1 };
            },
            upsert: async ({ create }: { create: Record<string, unknown> }) => {
                const replacement = { id: 1810, ...create }; replacements.push(replacement); return replacement;
            }
        },
        approvalDecision: { findUnique: async () => approval },
        artDirectionDecision: { findFirst: async () => artDecision },
        deliveryAttempt: { count: async () => options.attemptCount ?? 0 },
        workflowEvent: {
            findUnique: async ({ where }: { where: { project_id_actor_id_command_idempotency_key: {
                actor_id: string; command: string; idempotency_key: string } } }) => {
                const key = where.project_id_actor_id_command_idempotency_key;
                return events.find(event => event.actor_id === key.actor_id && event.command === key.command
                    && event.idempotency_key === key.idempotency_key) || null;
            },
            create: async ({ data }: { data: Omit<(typeof events)[number], 'id'> }) => {
                const event = { id: 2901, ...data }; events.push(event); return event;
            }
        },
        $transaction: async (run: (client: unknown) => Promise<unknown>) => run(database)
    };
    return { task, review, approval, artDecision, events, replacements,
        deps: { database: database as never }, get writes() { return writes; } };
}

test('task1051 preview exposes the bounded replacement diff without writes', async () => {
    const f = fixture();
    const result = await repairTask1051ReviewCollision(args, f.deps);
    assert.equal(result.mode, 'preview');
    assert.equal(f.writes, 0);
    assert.equal(f.replacements.length, 0);
    assert.equal(f.review.state, 'waiting_approval');
});

test('task1051 apply preserves task/history and creates one claimable revision-2 review base', async () => {
    const f = fixture();
    const before = structuredClone({ task: f.task, approval: f.approval, artDecision: f.artDecision,
        result_payload: f.review.result_payload });
    const result = await repairTask1051ReviewCollision({ ...args, confirm: true }, f.deps);
    assert.equal(f.review.state, 'completed');
    assert.deepEqual(f.review.result_payload, before.result_payload);
    assert.deepEqual(f.task, before.task);
    assert.deepEqual(f.approval, before.approval);
    assert.deepEqual(f.artDecision, before.artDecision);
    assert.equal(f.replacements.length, 1);
    assert.equal(f.replacements[0].state, 'available');
    assert.equal(f.replacements[0].input_context_version, 2);
    assert.equal(f.replacements[0].result_version, 2);
    assert.equal(result.replacement_work_item_id, 1810);
    assert.equal(result.release_or_publish_performed, false);
    assert.equal(f.events.length, 1);
    const replay = await repairTask1051ReviewCollision({ ...args, confirm: true }, f.deps);
    assert.equal(replay.replayed, true);
    assert.equal(f.replacements.length, 1);
});

test('task1051 repair aborts stale review or delivery attempt with zero writes', async () => {
    for (const f of [fixture({ reviewState: 'completed' }), fixture({ attemptCount: 1 })]) {
        await assert.rejects(repairTask1051ReviewCollision({ ...args, confirm: true }, f.deps),
            /TASK1051_REVIEW_REPAIR_GUARD_FAILED/);
        assert.equal(f.writes, 0);
        assert.equal(f.events.length, 0);
    }
});

test('task1051 repair rejects another task before database mutation', async () => {
    const f = fixture();
    await assert.rejects(repairTask1051ReviewCollision({ ...args, taskId: 1050 as 1051 }, f.deps),
        /TASK1051_REVIEW_REPAIR_SCOPE_MISMATCH/);
    assert.equal(f.writes, 0);
});

test('task1051 repair belongs to the Editor boundary only', () => {
    assert.equal(isToolAllowedForProfile('editor', 'ba_repair_task1051_review_collision'), true);
    for (const profile of ['planner', 'writer', 'art_director', 'publisher', 'growth_analyst'] as const) {
        assert.equal(isToolAllowedForProfile(profile, 'ba_repair_task1051_review_collision'), false);
    }
});
