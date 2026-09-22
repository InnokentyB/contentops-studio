import assert from 'node:assert/strict';
import test from 'node:test';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';

const hash = 'e7d8c1f2f9cf4f7e3ca1ad6fb05e55153c2153739b3fcdf280e519f574b7f7a6';
const schedule = new Date('2026-09-22T17:00:00.000Z');

function harness(ready = true) {
    const task: any = { id: 953, project_id: 10, channel_id: 138,
        channel: { type: 'threads', config: ready ? { threads_user_id: 'u1', access_token: 'secret' } : {} },
        content_revision: 4, accepted_revision: 4, text_state: 'accepted', draft_text: 'short body',
        visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 2, selected_asset_id: null,
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
        schedule_at: schedule, published_link: null, publication_fact: null, quality_report: {} };
    const events: any[] = [];
    let calls = 0;
    const db: any = {
        contentItem: { findFirst: async () => task,
            updateMany: async ({ where, data }: any) => task.status === where.status
                ? (Object.assign(task, data), { count: 1 }) : { count: 0 },
            update: async ({ data }: any) => (Object.assign(task, data), task) },
        workflowEvent: { findUnique: async ({ where }: any) => events.find(e => e.data.command === where.project_id_actor_id_command_idempotency_key.command)?.data || null,
            findFirst: async () => ({ after_state: { task_id: 953, channel_id: 138,
                content_revision: 4, accepted_revision: 4, body_sha256: hash,
                visual_decision_id: 149, schedule_at: schedule.toISOString() } }),
            create: async (e: any) => { events.push(e); return e; } },
        artDirectionDecision: { findFirst: async () => ({ id: 149, decision_version: 2 }) },
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (fn: any) => fn(db)
    };
    const service = new ThreadsTaskPublicationService({ db, hashBody: () => hash,
        threads: { publishPost: async () => (calls++, 'https://www.threads.net/post/p953') },
        facts: { record: async () => ({}) } });
    return { service, task, get calls() { return calls; } };
}

test('Threads #953 dry-run reports exact connector readiness', async () => {
    assert.equal((await harness().service.execute({ projectId: 10, taskId: 953, dryRun: true })).route_executable, true);
    const blocked = await harness(false).service.execute({ projectId: 10, taskId: 953, dryRun: true });
    assert.equal(blocked.route_blocker, 'THREADS_CONNECTOR_NOT_READY');
});

test('Threads #953 task-native send claims once and confirms URL', async () => {
    const h = harness();
    const sent = await h.service.execute({ projectId: 10, taskId: 953, idempotencyKey: 'send953' });
    assert.equal(sent.published_link, 'https://www.threads.net/post/p953');
    assert.equal(h.calls, 1);
    assert.equal(h.task.status, 'published');
});
