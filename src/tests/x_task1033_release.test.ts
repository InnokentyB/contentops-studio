import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseXTask1033, Task1033ReleaseArgs } from '../services/x_task1033_release.service';

const args: Task1033ReleaseArgs = {
    projectId: 10, taskId: 1033, actorId: 'user:2', expectedChannelId: 164,
    expectedContentRevision: 2, expectedAcceptedRevision: 2,
    expectedBodySha256: '9ba2558e09ef10b82babb3b3d605a3a281d5b8314ef9d78f652950bdf17d2cb8',
    expectedDecisionId: 243, expectedReviewWorkItemId: 1549, expectedArtWorkItemId: 1560,
    expectedScheduleAt: '2026-10-07T15:00:00.000Z',
    expectedManifestChecksum: 'sha256:e7f837d363d88c6a30c5e5daac002894f85ccd7e73249fa45ef07d7efc27e46f',
    approvalReference: 'Portfolio HQ owner GO 01a11720-67b8-7f10-b56a-22048db221e9', idempotencyKey: 'test-release'
};

function fixture() {
    const task = { channel_id: 164, channel: { type: 'x', name: 'innokenty_x' },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
        content_revision: 2, accepted_revision: 2, text_state: 'accepted', visual_state: 'NO_VISUAL_NEEDED',
        visual_placement: 'feed', selected_asset_id: null, schedule_at: new Date(args.expectedScheduleAt),
        publish_at: new Date(args.expectedScheduleAt), draft_text: 'fixture body', publication_fact: null,
        published_link: null, visual_decision_version: 1, quality_report: {}, week_package_id: null, item_key: 'test' };
    let creates = 0;
    let history: { before_state: unknown; after_state: unknown } | null = null;
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => history, create: async ({ data }: { data: typeof history }) => { history = data; } },
        contentItem: { findFirst: async () => task,
            updateMany: async ({ data }: { data: Partial<typeof task> }) => { Object.assign(task, data); return { count: 1 }; } },
        workItem: { findFirst: async ({ where }: { where: { id?: number } }) => where.id === 1549
            ? { kind: 'content_review', state: 'completed', input_context_version: 2, result_version: 2 }
            : where.id === 1560 ? { kind: 'art_direction', state: 'completed', input_context_version: 2, result_version: 1 } : null,
            create: async () => { creates += 1; return { id: 2000 }; } },
        artDirectionDecision: { findFirst: async () => ({ decision_version: 1 }) },
        deliveryAttempt: { findFirst: async () => null }
    };
    const db = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const manifest = async () => ({ checksum: args.expectedManifestChecksum }) as never;
    return { task, db: db as never, manifest, get creates() { return creates; } };
}

test('X1033 exact owner release creates one r2 work item and replays without a second item', async () => {
    const f = fixture();
    const first = await releaseXTask1033(args, f.db, f.manifest, () => args.expectedBodySha256);
    const replay = await releaseXTask1033(args, f.db, f.manifest, () => args.expectedBodySha256);
    assert.ok('published' in first);
    assert.equal(first.published, false);
    assert.equal(replay.replayed, true);
    assert.equal(f.creates, 1);
    assert.equal(f.task.publication_mode, 'browser_required');
    assert.equal(f.task.publication_fact, null);
});

for (const [field, value] of [['accepted_revision', 1], ['channel_id', 165], ['visual_decision_version', 2],
    ['visual_placement', 'story'], ['publication_mode', 'prepare_only']] as const) {
    test(`X1033 refuses changed ${field} without creating browser work`, async () => {
        const f = fixture(); Object.assign(f.task, { [field]: value });
        await assert.rejects(releaseXTask1033(args, f.db, f.manifest, () => args.expectedBodySha256), /GUARD_FAILED/);
        assert.equal(f.creates, 0);
    });
}
test('X1033 refuses body drift, wrong task and stale manifest before release', async () => {
    const f = fixture();
    await assert.rejects(releaseXTask1033(args, f.db, f.manifest, () => 'wrong-hash'), /GUARD_FAILED/);
    await assert.rejects(releaseXTask1033({ ...args, taskId: 1035 } as never, f.db, f.manifest), /SCOPE_MISMATCH/);
    await assert.rejects(releaseXTask1033(args, f.db, async () => ({ checksum: 'stale' }) as never), /STALE_MANIFEST/);
    assert.equal(f.creates, 0);
});
