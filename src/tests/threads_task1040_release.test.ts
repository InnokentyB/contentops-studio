import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePendingThreadsTask } from '../services/threads_pending_release.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { threads1040ReleaseSchema } from '../mcp/tools/threads_task1040_release_tool';

const sha = '6c7e36761a0f7cf48859f8f9ef673f3aa38105fa61c10d4ea592cbbeddc60353';
const checksum = `sha256:${'e'.repeat(64)}`;
const args = { projectId: 10, taskId: 1040, actorId: 'user:2', approvalReference: 'Owner current HQ GO publish now',
    idempotencyKey: '1040-exact-release', expectedManifestChecksum: checksum,
    newScheduleAt: new Date(Date.now() + 60_000).toISOString() };

function fixture() {
    const task = { channel_id: 138, content_revision: 4, accepted_revision: 4, text_state: 'accepted',
        visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null, visual_decision_version: 2,
        handoff_state: 'ready', publication_fact: null, published_link: null, publication_mode: 'approval_required',
        status: 'ready_for_execution', schedule_at: new Date('2026-10-08T16:30:00Z'),
        publish_at: new Date('2026-10-08T16:30:00Z'), visual_placement: 'feed', draft_text: 'fixture body' };
    let event: { before_state: Record<string, unknown>; after_state: Record<string, unknown> } | null = null;
    let attempt = false;
    let owner = true;
    let gates = true;
    let incompleteHistory = false;
    const tx = { projectMember: { findUnique: async () => ({ role: owner ? 'owner' : 'editor' }) },
        contentItem: { findFirst: async () => task, updateMany: async ({ data }: { data: Partial<typeof task> }) => {
            Object.assign(task, data); return { count: 1 }; } },
        workflowEvent: { findFirst: async () => event, create: async ({ data }: { data: NonNullable<typeof event> }) => { event = data; } },
        artDirectionDecision: { findFirst: async () => ({ decision_version: 2 }) },
        workItem: { findFirst: async ({ where }: { where: { id?: number } }) => where.id && gates ? { id: where.id } : null },
        deliveryAttempt: { findFirst: async () => attempt ? { id: 1 } : null } };
    const database = { ...tx, socialChannel: { findFirst: async () => ({ name: 'innokenty_threads',
        config: { access_token: 'fixture', threads_user_id: 'fixture' } }) },
        $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const deps = { database: database as never,
        threads: { testConnection: async () => ({ success: true, details: { username: 'innokentybo', id: 'fixture' } }),
            getOwnPosts: async () => ({ items: [], after: incompleteHistory ? 'next' : null }) } as never,
        manifestLoader: async () => ({ checksum }) as never, hashBody: () => sha };
    return { task, deps, get event() { return event; }, blockAttempt: () => { attempt = true; },
        revokeOwner: () => { owner = false; }, removeGates: () => { gates = false; },
        incompleteHistory: () => { incompleteHistory = true; } };
}

test('1040 release atomically reschedules exact accepted package and is idempotent without sending', async () => {
    const f = fixture();
    const result = await releasePendingThreadsTask(args, f.deps);
    assert.equal(result.content_revision, 4);
    assert.equal(result.visual_decision_id, 256);
    assert.equal(result.schedule_at, args.newScheduleAt);
    assert.equal(f.task.publish_at.toISOString(), args.newScheduleAt);
    assert.equal(f.task.publication_mode, 'owner_released');
    assert.equal(f.task.draft_text, 'fixture body');
    assert.equal(f.task.publication_fact, null);
    assert.deepEqual(await releasePendingThreadsTask(args, f.deps), result);
});

for (const failure of ['owner', 'attempt', 'gates', 'revision', 'body', 'manifest', 'time', 'fact', 'history'] as const) {
    test(`1040 refuses ${failure} without changing schedule or writing release`, async () => {
        const f = fixture(); let input = args;
        if (failure === 'owner') f.revokeOwner();
        if (failure === 'attempt') f.blockAttempt();
        if (failure === 'gates') f.removeGates();
        if (failure === 'revision') f.task.accepted_revision = 3;
        if (failure === 'body') f.deps.hashBody = () => 'bad';
        if (failure === 'manifest') input = { ...args, expectedManifestChecksum: 'bad' };
        if (failure === 'time') input = { ...args, newScheduleAt: '2020-01-01T00:00:00Z' };
        if (failure === 'fact') f.task.published_link = 'https://threads.net/@fixture/post/exists' as never;
        if (failure === 'history') f.incompleteHistory();
        await assert.rejects(releasePendingThreadsTask(input, f.deps),
            /OWNER_REQUIRED|DELIVERY_ATTEMPT_EXISTS|PACKAGE_CHANGED|STALE_MANIFEST|SCHEDULE_REQUIRED|HISTORY_INCOMPLETE/);
        assert.equal(f.event, null);
        assert.equal(f.task.schedule_at.toISOString(), '2026-10-08T16:30:00.000Z');
    });
}

test('1040 release is publisher scoped and cannot release another task/project', () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_threads_task1040'), true);
    assert.equal(isToolAllowedForProfile('editor', 'ba_release_approved_threads_task1040'), false);
    assert.equal(threads1040ReleaseSchema.safeParse({ ...args, taskId: 1035 }).success, false);
    assert.equal(threads1040ReleaseSchema.safeParse({ ...args, projectId: 7 }).success, false);
});
