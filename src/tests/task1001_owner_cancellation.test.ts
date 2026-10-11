import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cancelTask1001Owner,
    TASK1001_CANCELLATION_KEY,
    TASK1001_MANIFEST_CHECKSUM
} from '../services/task1001_owner_cancellation.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const args = {
    projectId: 10, taskId: 1001, actorId: 'user:2',
    expectedManifestChecksum: TASK1001_MANIFEST_CHECKSUM,
    expectedStatus: 'planned', expectedPublicationMode: 'approval_required',
    expectedContentRevision: 0, expectedAcceptedRevision: null,
    expectedBodySha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    expectedSelectedAssetId: null, expectedDeliveryAttemptCount: 0,
    expectedContentWriteState: 'available', expectedPendingCheckpointCount: 3,
    ownerAuthorizationReference: 'Portfolio HQ explicit cancellation 2026-10-11',
    idempotencyKey: TASK1001_CANCELLATION_KEY
} as const;

function fixture(options: { status?: string; attemptCount?: number; checkpointCount?: number } = {}) {
    const checkpointWorkItems = Array.from({ length: options.checkpointCount ?? 3 }, (_, index) => ({
        id: 9001 + index, kind: 'metric_checkpoint', state: 'pending'
    }));
    const task = { id: 1001, project_id: 10, status: options.status || 'planned',
        publication_mode: 'approval_required', content_revision: 0, accepted_revision: null,
        draft_text: '', selected_asset_id: null, publication_fact: null, published_link: null,
        quality_report: {}, image_assets: [],
        work_items: [{ id: 8001, kind: 'content_write', state: 'available' }, ...checkpointWorkItems] };
    const attempts = Array.from({ length: options.attemptCount || 0 }, (_, index) => ({ id: index + 1 }));
    const events: Array<{ id: number; actor_id: string; command: string; idempotency_key: string;
        before_state: unknown; after_state: unknown }> = [];
    let writes = 0;
    const database = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                if (task.status !== where.status || task.publication_mode !== where.publication_mode) return { count: 0 };
                writes += 1; Object.assign(task, data); return { count: 1 };
            }
        },
        deliveryAttempt: { count: async () => attempts.length },
        metricSnapshot: { findMany: async () => { throw new Error('metric snapshots are not checkpoint obligations'); } },
        workflowEvent: {
            findUnique: async ({ where }: { where: { project_id_actor_id_command_idempotency_key: {
                actor_id: string; command: string; idempotency_key: string } } }) => {
                const key = where.project_id_actor_id_command_idempotency_key;
                return events.find(event => event.actor_id === key.actor_id && event.command === key.command
                    && event.idempotency_key === key.idempotency_key) || null;
            },
            create: async ({ data }: { data: Omit<(typeof events)[number], 'id'> }) => {
                const event = { id: 7001 + events.length, ...data }; events.push(event); return event;
            }
        },
        $transaction: async (run: (client: unknown) => Promise<unknown>) => run(database)
    };
    const dependencies = { database: database as never,
        manifestLoader: async () => ({ checksum: TASK1001_MANIFEST_CHECKSUM }) };
    return { task, checkpoints: checkpointWorkItems, events, dependencies, get writes() { return writes; } };
}

test('exact task1001 cancellation changes only status/mode and records an immutable audit', async () => {
    const h = fixture();
    const before = structuredClone({ draft_text: h.task.draft_text, work_items: h.task.work_items,
        checkpoints: h.checkpoints, quality_report: h.task.quality_report });
    const result = await cancelTask1001Owner(args, h.dependencies);
    assert.equal(h.task.status, 'cancelled');
    assert.equal(h.task.publication_mode, 'retired');
    assert.deepEqual({ draft_text: h.task.draft_text, work_items: h.task.work_items,
        checkpoints: h.checkpoints, quality_report: h.task.quality_report }, before);
    assert.equal(result.audit_id, 7001);
    assert.deepEqual(result.affected_task_ids, [1001]);
    assert.equal(result.publication_sent, false);
    const replay = await cancelTask1001Owner(args, h.dependencies);
    assert.equal(replay.replayed, true);
    assert.equal(h.writes, 1);
});

test('task1001 cancellation rejects stale task, attempts or checkpoint count with zero writes', async () => {
    for (const h of [fixture({ status: 'ready' }), fixture({ attemptCount: 1 }), fixture({ checkpointCount: 2 })]) {
        await assert.rejects(cancelTask1001Owner(args, h.dependencies), /TASK1001_CANCELLATION_GUARD_FAILED/);
        assert.equal(h.writes, 0);
        assert.equal(h.events.length, 0);
    }
});

test('task1001 cancellation rejects another task before database access', async () => {
    const h = fixture();
    await assert.rejects(cancelTask1001Owner({ ...args, taskId: 1002 as 1001 }, h.dependencies),
        /TASK1001_CANCELLATION_SCOPE_MISMATCH/);
    assert.equal(h.writes, 0);
});

test('task1001 cancellation is domain-owner guarded and unavailable to planning/content roles', () => {
    assert.equal(isToolAllowedForProfile('owner', 'ba_cancel_task1001_owner'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_cancel_task1001_owner'), true);
    for (const role of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist'] as const) {
        assert.equal(isToolAllowedForProfile(role, 'ba_cancel_task1001_owner'), false);
    }
});
