import test from 'node:test';
import assert from 'node:assert/strict';
import { THREADS1046_MANIFEST_CHECKSUM, releaseThreadsTask1046 } from '../services/threads_task1046_release.service';

const BODY_SHA = 'e3403bd77725ff503627cdecca3a2ce423f148af75ac25830add9652ae25adb9';
const ASSET_SHA = '1b9177bbdc77a4d29f0c950f14f85f16f018c2a45544aa8f75ff6e8f00db2e03';
const SCHEDULE = '2026-10-10T16:30:00.000Z';

const args = {
    projectId: 10, taskId: 1046, actorId: 'user:2',
    expectedManifestChecksum: THREADS1046_MANIFEST_CHECKSUM,
    approvalReference: 'Owner authorized exact Threads 1046 release',
    idempotencyKey: 'threads1046-owner-release-v1'
} as const;

function fixture() {
    const task = {
        id: 1046, project_id: 10, channel_id: 138,
        channel: { id: 138, project_id: 10, type: 'threads', name: 'innokenty_threads', is_active: true,
            config: { access_token: 'fixture', threads_user_id: '39421253764155091' } },
        content_revision: 4, accepted_revision: 4, text_state: 'accepted', draft_text: 'exact body',
        visual_state: 'APPROVED', visual_placement: 'feed', visual_decision_version: 1,
        selected_asset_id: 132, selected_asset: { id: 132, status: 'approved', content_revision: 4,
            file_url: 'https://assets.example/task1046.png',
            provenance: { planner_storage: { managed: true, sha256: ASSET_SHA } } },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
        schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE), publication_fact: null,
        published_link: null, telegram_message_id: null, quality_report: {}
    };
    let event: { before_state: Record<string, unknown>; after_state: Record<string, unknown> } | null = null;
    let attempt = false;
    let browserWork = false;
    let sends = 0;
    let historyAfter: string | null = null;
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: { where: { status: string; publication_mode: string }; data: Partial<typeof task> }) => {
                if (task.status !== where.status || task.publication_mode !== where.publication_mode) return { count: 0 };
                Object.assign(task, data); return { count: 1 };
            }
        },
        workflowEvent: {
            findFirst: async () => event,
            create: async ({ data }: { data: typeof event }) => { event = data; }
        },
        artDirectionDecision: { findFirst: async () => ({ id: 270, decision_version: 1 }) },
        deliveryAttempt: { findFirst: async () => attempt ? { id: 9001 } : null },
        workItem: { findFirst: async () => browserWork ? { id: 9002 } : null }
    };
    const database = { ...tx, socialChannel: { findFirst: async () => task.channel },
        $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const dependencies = {
        database: database as never,
        manifestLoader: async () => ({ checksum: THREADS1046_MANIFEST_CHECKSUM }) as never,
        hashBody: () => BODY_SHA,
        now: () => new Date('2026-10-10T12:00:00.000Z'),
        threads: {
            testConnection: async () => ({ success: true,
                details: { id: '39421253764155091', username: 'innokentybo' } }),
            getOwnPosts: async () => ({ items: [], after: historyAfter }),
            publishPost: async () => { sends += 1; return ''; }
        }
    };
    return { task, dependencies, get event() { return event; }, get sends() { return sends; },
        addAttempt: () => { attempt = true; }, addBrowserWork: () => { browserWork = true; },
        makeHistoryIncomplete: () => { historyAfter = 'next'; } };
}

test('exact Threads1046 owner release binds the approved image package without publishing', async () => {
    const f = fixture();
    const result = await releaseThreadsTask1046(args, f.dependencies as never);
    const replay = await releaseThreadsTask1046(args, f.dependencies as never);
    assert.equal(result.task_id, 1046);
    assert.equal(result.body_sha256, BODY_SHA);
    assert.equal(result.visual_decision_id, 270);
    assert.equal(result.selected_asset_id, 132);
    assert.equal(result.asset_sha256, ASSET_SHA);
    assert.equal(result.schedule_at, SCHEDULE);
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.published, false);
    assert.equal(replay.replayed, true);
    assert.equal(f.task.publication_mode, 'owner_released');
    assert.equal(f.task.status, 'ready_for_execution');
    assert.equal(f.task.selected_asset_id, 132);
    assert.equal(f.task.publication_fact, null);
    assert.equal(f.sends, 0);
});

for (const blocker of ['fact', 'attempt', 'delivery', 'browser', 'uncertain', 'asset', 'body', 'identity', 'history'] as const) {
    test(`Threads1046 release fails closed on ${blocker}`, async () => {
        const f = fixture();
        if (blocker === 'fact') f.task.publication_fact = { id: 441 } as never;
        if (blocker === 'attempt') f.addAttempt();
        if (blocker === 'delivery') f.task.quality_report = {
            publication_task_delivery: { state: 'failed_before_provider' }
        };
        if (blocker === 'browser') f.addBrowserWork();
        if (blocker === 'uncertain') f.task.quality_report = {
            publication_task_delivery: { state: 'provider_result_uncertain' }
        };
        if (blocker === 'asset') f.task.selected_asset.provenance = { planner_storage: { managed: true, sha256: 'bad' } };
        if (blocker === 'body') f.dependencies.hashBody = () => 'bad';
        if (blocker === 'identity') f.dependencies.threads.testConnection = async () => ({ success: true,
            details: { id: 'wrong', username: 'someone_else' } }) as never;
        if (blocker === 'history') f.makeHistoryIncomplete();
        await assert.rejects(releaseThreadsTask1046(args, f.dependencies as never),
            /FACT_EXISTS|DELIVERY_ATTEMPT_EXISTS|PRIOR_DELIVERY_STATE_EXISTS|BROWSER_PUBLICATION_ALREADY_QUEUED|UNCERTAIN_ATTEMPT_EXISTS|PACKAGE_CHANGED|IDENTITY_NOT_VERIFIED|HISTORY_INCOMPLETE/);
        assert.equal(f.event, null);
        assert.equal(f.task.publication_mode, 'approval_required');
        assert.equal(f.sends, 0);
    });
}
