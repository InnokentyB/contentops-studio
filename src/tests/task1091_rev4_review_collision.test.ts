import test from 'node:test';
import assert from 'node:assert/strict';
import {
    repairTask1091Rev4ReviewCollision,
    TASK1091_REV4_BODY_SHA256,
    TASK1091_REV4_MANIFEST_CHECKSUM,
    TASK1091_REV4_REVIEW_REPAIR_KEY
} from '../services/task1091_rev4_review_collision.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const schedule = new Date('2026-10-13T17:30:00.000Z');
const args = {
    projectId: 10, taskId: 1091, collisionWorkItemId: 1656, staleWorkItemId: 1866,
    actorId: 'user:2', expectedManifestChecksum: TASK1091_REV4_MANIFEST_CHECKSUM,
    expectedContentRevision: 4, expectedAcceptedRevision: null,
    expectedBodySha256: TASK1091_REV4_BODY_SHA256, expectedChannelId: 108,
    expectedScheduleAt: '2026-10-13T17:30:00.000Z', expectedCollisionInputContextVersion: 4,
    expectedCollisionResultVersion: 2, expectedStaleInputContextVersion: 3,
    expectedStaleResultVersion: 3, idempotencyKey: TASK1091_REV4_REVIEW_REPAIR_KEY,
    reason: 'Owner-authorized exact task 1091 revision-4 review recovery', confirm: false
} as const;

function fixture(options: { collisionState?: string; attemptCount?: number } = {}) {
    const task = { id: 1091, project_id: 10,
        title: 'Kun Chen: агентские тесты не доказывают правильность. Что это меняет для TDPD',
        item_key: 'PORTFOLIO-OS-PERSONAL-TG-20261013-01', status: 'drafted',
        content_revision: 4, accepted_revision: null, text_state: 'draft', draft_text: 'rev4',
        channel_id: 108, schedule_at: schedule, publish_at: schedule,
        publication_mode: 'approval_required', publication_fact: null, published_link: null,
        selected_asset_id: null, visual_state: 'STALE', visual_mode: 'auto_assess',
        visual_placement: 'feed', visual_decision_version: 2, handoff_state: 'blocked' };
    const collision = { id: 1656, project_id: 10, content_item_id: 1091,
        week_package_id: null, item_key: task.item_key, kind: 'content_review',
        state: options.collisionState ?? 'available', assignee_role: 'content_reviewer',
        due_at: schedule, input_context_version: 4, result_version: 2, result_payload: null,
        lease_token: null, lease_actor_id: null };
    const stale = { id: 1866, project_id: 10, content_item_id: 1091,
        week_package_id: null, item_key: task.item_key, kind: 'content_review',
        state: 'waiting_approval', assignee_role: 'content_reviewer', due_at: schedule,
        input_context_version: 3, result_version: 3,
        result_payload: { body: 'rev4', content_revision: 3 },
        lease_token: null, lease_actor_id: null };
    const approvals = new Map([[1656, { id: 301, work_item_id: 1656, result_version: 2,
        decision: 'approved' }], [1866, { id: 345, work_item_id: 1866, result_version: 3,
        decision: 'approved' }]]);
    const events: Array<Record<string, unknown>> = [];
    const replacements: Array<Record<string, unknown>> = [];
    let writes = 0;
    const database = {
        project: { findUnique: async () => ({ id: 10, slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => task },
        workItem: {
            findFirst: async ({ where }: { where: { id: number } }) =>
                where.id === 1656 ? collision : stale,
            count: async () => 2,
            updateMany: async ({ where, data }: { where: { id: number; state: string };
                data: Record<string, unknown> }) => {
                const item = where.id === 1656 ? collision : stale;
                if (item.state !== where.state) return { count: 0 };
                writes++; Object.assign(item, data); return { count: 1 };
            },
            upsert: async ({ create }: { create: Record<string, unknown> }) => {
                const item = { id: 1904, ...create }; replacements.push(item); return item;
            }
        },
        approvalDecision: { findUnique: async ({ where }: { where: {
            work_item_id_result_version: { work_item_id: number } } }) =>
            approvals.get(where.work_item_id_result_version.work_item_id) },
        deliveryAttempt: { count: async () => options.attemptCount ?? 0 },
        workflowEvent: {
            count: async () => 0,
            findUnique: async () => events[0] || null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const event = { id: 3093, ...data }; events.push(event); return event;
            }
        },
        $transaction: async (run: (client: unknown) => Promise<unknown>) => run(database)
    };
    return { task, collision, stale, approvals, events, replacements,
        deps: { database: database as never,
            manifestLoader: async () => ({ checksum: TASK1091_REV4_MANIFEST_CHECKSUM }),
            hashBody: () => TASK1091_REV4_BODY_SHA256 },
        get writes() { return writes; } };
}

test('task1091 rev4 preview exposes both supersessions and fresh review without writes', async () => {
    const f = fixture();
    const result = await repairTask1091Rev4ReviewCollision(args, f.deps);
    assert.equal(result.mode, 'preview');
    assert.equal(f.writes, 0);
    assert.equal(f.replacements.length, 0);
    assert.deepEqual(result.collision_prevention, {
        prior_approval_pairs: ['1656:2', '1866:3'],
        replacement_result_version: 4, fresh_work_item_required: true
    });
});

test('task1091 rev4 apply preserves content and creates one claimable i4/r4 review', async () => {
    const f = fixture();
    const before = structuredClone(f.task);
    const result = await repairTask1091Rev4ReviewCollision({ ...args, confirm: true }, f.deps);
    assert.deepEqual(f.task, before);
    assert.equal(f.collision.state, 'completed');
    assert.equal(f.stale.state, 'completed');
    assert.equal(f.approvals.get(1656)?.decision, 'approved');
    assert.equal(f.approvals.get(1866)?.decision, 'approved');
    assert.equal(f.replacements.length, 1);
    assert.equal(f.replacements[0].state, 'available');
    assert.equal(f.replacements[0].input_context_version, 4);
    assert.equal(f.replacements[0].result_version, 4);
    assert.equal(result.replacement_work_item_id, 1904);
    assert.equal(result.release_or_publish_performed, false);
    const replay = await repairTask1091Rev4ReviewCollision({ ...args, confirm: true }, f.deps);
    assert.equal(replay.replayed, true);
    assert.equal(f.replacements.length, 1);
});

test('task1091 rev4 repair stops on stale review or delivery attempt', async () => {
    for (const f of [fixture({ collisionState: 'claimed' }), fixture({ attemptCount: 1 })]) {
        await assert.rejects(
            repairTask1091Rev4ReviewCollision({ ...args, confirm: true }, f.deps),
            /TASK1091_REV4_REVIEW_REPAIR_GUARD_FAILED/);
        assert.equal(f.writes, 0);
        assert.equal(f.events.length, 0);
    }
});

test('task1091 rev4 repair rejects wrong task before mutation', async () => {
    const f = fixture();
    await assert.rejects(repairTask1091Rev4ReviewCollision({ ...args, taskId: 1000 as 1091 }, f.deps),
        /TASK1091_REV4_REVIEW_REPAIR_SCOPE_MISMATCH/);
    assert.equal(f.writes, 0);
});

test('task1091 rev4 repair is Editor-only', () => {
    assert.equal(isToolAllowedForProfile('editor', 'ba_repair_task1091_rev4_review_collision'), true);
    for (const profile of ['planner', 'writer', 'art_director', 'publisher', 'growth_analyst'] as const) {
        assert.equal(isToolAllowedForProfile(profile,
            'ba_repair_task1091_rev4_review_collision'), false);
    }
});
