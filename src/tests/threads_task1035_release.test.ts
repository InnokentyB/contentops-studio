import assert from 'node:assert/strict';
import test from 'node:test';
import { PENDING_THREADS_PACKAGES, releasePendingThreadsTask } from '../services/threads_pending_release.service';

const spec = PENDING_THREADS_PACKAGES[1035];
const args = { projectId: 10, taskId: 1035, actorId: 'user:2', approvalReference: 'Owner GO Portfolio HQ 01a11720', idempotencyKey: 'test-release' };

function fixture() {
    const task = { channel_id: 138, content_revision: 1, accepted_revision: 1, text_state: 'accepted',
        visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null, visual_decision_version: 1,
        handoff_state: 'ready', publication_fact: null, published_link: null, publication_mode: 'approval_required',
        status: 'ready_for_execution', schedule_at: new Date(spec.schedule), publish_at: new Date(spec.schedule),
        visual_placement: 'feed', draft_text: 'fixture body' };
    let releaseEvents = 0;
    let workPresent = true;
    let ownerRole = 'owner';
    const tx = {
        projectMember: { findUnique: async () => ({ role: ownerRole }) },
        contentItem: { findFirst: async () => task,
            updateMany: async ({ data }: { data: Partial<typeof task> }) => { Object.assign(task, data); return { count: 1 }; } },
        workflowEvent: { findFirst: async () => null, create: async () => { releaseEvents += 1; } },
        artDirectionDecision: { findFirst: async () => ({ decision_version: 1 }) },
        workItem: { findFirst: async ({ where }: { where: { id?: number } }) => where.id && workPresent ? { id: where.id } : null },
        deliveryAttempt: { findFirst: async () => null }
    };
    const database = { ...tx, socialChannel: { findFirst: async () => ({ name: 'innokenty_threads', config: { access_token: 'fixture', threads_user_id: 'fixture' } }) },
        $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const dependencies = { database: database as never,
        threads: { testConnection: async () => ({ success: true, details: { username: 'innokentybo', id: 'fixture' } }),
            getOwnPosts: async () => ({ items: [], after: null }) } as never,
        manifestLoader: async () => ({ checksum: 'sha256:e7f837d363d88c6a30c5e5daac002894f85ccd7e73249fa45ef07d7efc27e46f' }) as never,
        hashBody: (): string => spec.bodySha256 };
    return { task, dependencies, get releaseEvents() { return releaseEvents; },
        removeWork: () => { workPresent = false; }, revokeOwner: () => { ownerRole = 'editor'; } };
}

test('Threads1035 exact release authorizes native execution without a provider send or fact', async () => {
    const f = fixture();
    const result = await releasePendingThreadsTask(args, f.dependencies);
    assert.equal(result.publication_authorized, true);
    assert.equal(result.published, false);
    assert.equal(f.releaseEvents, 1);
    assert.equal(f.task.publication_mode, 'owner_released');
    assert.equal(f.task.publication_fact, null);
});
for (const failure of ['body', 'work', 'owner', 'revision', 'placement'] as const) {
    test(`Threads1035 refuses ${failure} drift without release event`, async () => {
        const f = fixture();
        if (failure === 'body') f.dependencies.hashBody = () => 'bad-hash';
        if (failure === 'work') f.removeWork();
        if (failure === 'owner') f.revokeOwner();
        if (failure === 'revision') f.task.accepted_revision = 2;
        if (failure === 'placement') f.task.visual_placement = 'story';
        await assert.rejects(releasePendingThreadsTask(args, f.dependencies), /OWNER_REQUIRED|PACKAGE_CHANGED/);
        assert.equal(f.releaseEvents, 0);
    });
}
