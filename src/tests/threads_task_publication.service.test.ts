import assert from 'node:assert/strict';
import test from 'node:test';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';

const hash = 'e7d8c1f2f9cf4f7e3ca1ad6fb05e55153c2153739b3fcdf280e519f574b7f7a6';
const schedule = new Date('2026-09-22T17:00:00.000Z');

function harness(ready = true, taskId: 953 | 966 | 997 = 953) {
    const spec = taskId === 953
        ? { revision: 4, hash, decisionId: 149, schedule, body: 'short body' }
        : taskId === 966 ? { revision: 1, hash: '83dd0fe0b2b354898b9fd3e5161d5ab05517c4c2b2304862d74c949ce1e2b123',
            decisionId: 142, schedule: new Date('2026-09-26T18:00:00.000Z'), body: 'task 966 body' }
            : { revision: 1, hash: '53abc96f1fc3287ca47ff5be457335fed2e33c0955e11f527dbe23d8299cf94b',
                decisionId: 181, schedule: null,
                body: '1/3 First native post.\n\n---\n\n2/3 Second native post.\n\n---\n\n3/3 Final native post with link.' };
    const task: any = { id: taskId, project_id: 10, channel_id: 138,
        channel: { type: 'threads', config: ready ? { threads_user_id: 'u1', access_token: 'secret' } : {} },
        content_revision: spec.revision, accepted_revision: spec.revision, text_state: 'accepted', draft_text: spec.body,
        visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 2, selected_asset_id: null,
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
        schedule_at: spec.schedule, published_link: null, publication_fact: null, quality_report: {} };
    const events: any[] = [];
    let calls = 0;
    const db: any = {
        contentItem: { findFirst: async () => task,
            updateMany: async ({ where, data }: any) => task.status === where.status
                ? (Object.assign(task, data), { count: 1 }) : { count: 0 },
            update: async ({ data }: any) => (Object.assign(task, data), task) },
        workflowEvent: { findUnique: async ({ where }: any) => events.find(e => e.data.command === where.project_id_actor_id_command_idempotency_key.command)?.data || null,
            findFirst: async () => ({ id: taskId === 997 ? 1887 : 100, after_state: { task_id: taskId, channel_id: 138,
                content_revision: spec.revision, accepted_revision: spec.revision, body_sha256: spec.hash,
                visual_decision_id: spec.decisionId, schedule_at: spec.schedule?.toISOString() ?? null,
                publication_authorized: true } }),
            create: async (e: any) => { events.push(e); return e; } },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.channel, taskId === 997 ? 'threads' : 'innokenty_threads');
            return { id: spec.decisionId, decision_version: 2 };
        } },
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (fn: any) => fn(db)
    };
    const service = new ThreadsTaskPublicationService({ db, hashBody: () => spec.hash,
        threads: {
            publishPost: async () => (calls++, `https://www.threads.net/post/p${taskId}`),
            publishThread: async () => (calls++, {
                rootUrl: `https://www.threads.net/post/p${taskId}-1`,
                postUrls: [1, 2, 3].map(index => `https://www.threads.net/post/p${taskId}-${index}`)
            })
        },
        facts: { record: async () => ({}) } });
    return { service, task, get calls() { return calls; } };
}

test('Threads #953 dry-run reports exact connector readiness', async () => {
    assert.equal((await harness().service.execute({ projectId: 10, taskId: 953, dryRun: true })).route_executable, true);
    const blocked = await harness(false).service.execute({ projectId: 10, taskId: 953, dryRun: true });
    assert.equal(blocked.route_blocker, 'THREADS_CONNECTOR_NOT_READY');
});

test('Threads #966 dry-run consumes only its exact owner-release proof', async () => {
    const result = await harness(true, 966).service.execute({ projectId: 10, taskId: 966, dryRun: true });
    assert.equal(result.route_executable, true);
    assert.equal(result.task_id, 966);
    assert.equal(result.payload_preview.accepted_revision, 1);
    assert.equal(result.payload_preview.visual_decision_id, 142);
});

test('Threads #953 task-native send claims once and confirms URL', async () => {
    const h = harness();
    const sent = await h.service.execute({ projectId: 10, taskId: 953, idempotencyKey: 'send953' });
    assert.equal(sent.published_link, 'https://www.threads.net/post/p953');
    assert.equal(h.calls, 1);
    assert.equal(h.task.status, 'published');
});

test('Threads #997 dry-run consumes release event #1887 and exposes the exact three-post chain without sending', async () => {
    const h = harness(true, 997);
    const result = await h.service.execute({ projectId: 10, taskId: 997, dryRun: true });
    assert.equal(result.route_executable, true);
    assert.equal(result.payload_preview.posts.length, 3);
    assert.deepEqual(result.payload_preview.posts.map((post: string) => post.slice(0, 3)), ['1/3', '2/3', '3/3']);
    assert.equal(result.payload_preview.release_event_id, 1887);
    assert.equal(h.calls, 0);
});
