import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseThreadsTask1021 } from '../services/owner_targeted_release_operations';

const bodyHash = 'f505415d56f83b199ae501ac825694cff849331bf29849b672ea89f732fa9e6b';
const schedule = '2026-10-04T16:30:00.000Z';

function harness(overrides: Record<string, unknown> = {}) {
    const task = {
        id: 1021, project_id: 10, channel_id: 138, channel: { type: 'threads' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', draft_text: 'task 1021 body',
        visual_placement: 'feed', visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 1,
        selected_asset_id: null, status: 'ready_for_execution', handoff_state: 'ready',
        publication_mode: 'approval_required', schedule_at: new Date(schedule), publish_at: new Date(schedule),
        publication_fact: null, published_link: null, ...overrides
    };
    const events: Array<Record<string, unknown>> = [];
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => (events.push(data), data) },
        contentItem: { findFirst: async () => task,
            updateMany: async ({ data }: { data: Record<string, unknown> }) => (Object.assign(task, data), { count: 1 }) },
        artDirectionDecision: { findFirst: async () => ({ id: 197, decision_version: 1 }) },
        deliveryAttempt: { findFirst: async () => null }
    };
    return { task, events, deps: { db: { $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx) },
        hashBody: () => bodyHash, requireOwner: async () => undefined } };
}

const args = { projectId: 10, actorId: 'user:2', taskId: 1021, expectedChannelId: 138,
    expectedContentRevision: 1, expectedAcceptedRevision: 1, expectedScheduleAt: schedule,
    expectedBodySha256: bodyHash, approvalReference: 'Portfolio HQ owner: publish Threads #1021 on 2026-10-05',
    idempotencyKey: 'threads-1021-owner-release-r1-20261005-v1' };

test('Threads #1021 owner release is exact, audited and does not publish', async () => {
    const h = harness();
    const result = await releaseThreadsTask1021(h.deps, args);
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.published, false);
    assert.equal(h.task.publication_mode, 'owner_released');
    assert.equal(h.events[0].command, 'ba_release_approved_threads_task1021');
});

test('Threads #1021 release fails closed on revision, fact or body drift', async () => {
    await assert.rejects(() => releaseThreadsTask1021(harness({ accepted_revision: null }).deps, args), /THREADS_1021_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseThreadsTask1021(harness({ publication_fact: { id: 1 } }).deps, args), /THREADS_1021_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseThreadsTask1021(harness().deps, { ...args, expectedBodySha256: 'a'.repeat(64) }), /THREADS_1021_SCOPE_MISMATCH/);
});
