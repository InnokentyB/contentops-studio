import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseThreadsTask1051, THREADS1051_SPEC } from '../services/threads_task1051_release.service';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';

const body = `Yesterday I had a Threads post ready to publish. The copy was approved, but the attached visual no longer matched the decision.

The easy fix was to detach the image and press send.

I didn't.

I restored the text-only version as a new revision, ran review again, created a fresh release, and published that exact package once.

It took a few extra minutes. It left a clean answer to a question that matters later: what exactly did we approve?

Manual fixes are fast until you need an audit trail.`;

const releaseArgs = { projectId: 10, taskId: 1051, actorId: 'user:2',
    expectedManifestChecksum: THREADS1051_SPEC.manifestChecksum,
    approvalReference: 'Owner GO 2026-10-11 task 1051 recovery',
    idempotencyKey: 'release-p10-threads1051-r2-recovery-20261011-01' } as const;

function fixture() {
    const task = { id: 1051, project_id: 10, channel_id: 138, status: 'ready_for_execution',
        publication_mode: 'approval_required', handoff_state: 'ready', content_revision: 2,
        accepted_revision: 2, text_state: 'accepted', draft_text: body, visual_state: 'NO_VISUAL_NEEDED',
        visual_placement: 'feed', visual_decision_version: 2, selected_asset_id: null,
        selected_asset: null, schedule_at: new Date(THREADS1051_SPEC.schedule),
        publish_at: new Date(THREADS1051_SPEC.schedule), published_link: null, publication_fact: null,
        telegram_message_id: null, quality_report: {}, channel: { id: 138, project_id: 10,
            name: 'innokenty_threads', type: 'threads', is_active: true,
            config: { access_token: 'fixture', threads_user_id: THREADS1051_SPEC.threadsUserId } } };
    type Event = { id: number; data: { command: string; idempotency_key: string;
        before_state?: unknown; after_state?: unknown }; before_state?: unknown; after_state?: unknown };
    type ThreadsMock = {
        testConnection(): Promise<{ success: boolean; details: { id: string; username: string } }>;
        getOwnPosts(): Promise<{ items: Array<{ text?: string }>; after?: string }>;
        publishPost(): Promise<string>;
    };
    const events: Event[] = [];
    const attempts: unknown[] = [];
    let providerCalls = 0;
    const database: Record<string, unknown> = {
        projectMember: {
            findUnique: async () => ({ role: 'owner', user_id: 2 }),
            findFirst: async () => ({ role: 'owner', user_id: 2 })
        },
        socialChannel: { findFirst: async () => task.channel },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
                if (task.status !== where.status || task.publication_mode !== where.publication_mode) return { count: 0 };
                Object.assign(task, data); return { count: 1 };
            },
            update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(task, data); return task; }
        },
        artDirectionDecision: { findFirst: async () => ({ id: 282, decision_version: 2,
            source_content_revision: 2, decision: 'NO_VISUAL_NEEDED', channel: 'threads',
            placement: 'feed', status: 'active' }) },
        deliveryAttempt: { findFirst: async () => attempts[0] || null },
        workItem: { findFirst: async () => null },
        workflowEvent: {
            findFirst: async ({ where }: { where: { command: string } }) =>
                events.find(event => event.data.command === where.command) || null,
            findUnique: async ({ where }: { where: { project_id_actor_id_command_idempotency_key:
                { command: string; idempotency_key: string } } }) => {
                const key = where.project_id_actor_id_command_idempotency_key;
                return events.find(event => event.data.command === key.command
                    && event.data.idempotency_key === key.idempotency_key) || null;
            },
            create: async ({ data }: { data: Event['data'] }) => { const event: Event = { id: 3000 + events.length, data,
                before_state: data.before_state, after_state: data.after_state }; events.push(event); return event; }
        },
        $transaction: async (run: (tx: Record<string, unknown>) => Promise<unknown>) => run(database)
    };
    const threads: ThreadsMock = {
        testConnection: async () => ({ success: true,
            details: { id: THREADS1051_SPEC.threadsUserId, username: THREADS1051_SPEC.username } }),
        getOwnPosts: async () => ({ items: [] }),
        publishPost: async () => { providerCalls++; return 'https://www.threads.net/@innokentybo/post/EXACT1051'; }
    };
    const facts = { record: async () => ({ publication_fact: { id: 501 }, created_checkpoints: [701, 702] }) };
    const deps = { database, manifestLoader: async () => ({ checksum: THREADS1051_SPEC.manifestChecksum }),
        threads, hashBody: THREADS1051_SPEC.hashBody, now: () => new Date('2026-10-11T13:00:00.000Z') };
    return { task, events, attempts, deps, threads, facts,
        publication: new ThreadsTaskPublicationService({ db: database, threads, facts,
            hashBody: THREADS1051_SPEC.hashBody }), get providerCalls() { return providerCalls; } };
}

test('task1051 release preserves the original slot and records exact owner proof without publishing', async () => {
    const f = fixture();
    const result = await releaseThreadsTask1051(releaseArgs, f.deps as never);
    assert.equal(f.task.publication_mode, 'owner_released');
    assert.equal(f.task.schedule_at.toISOString(), THREADS1051_SPEC.schedule);
    assert.equal(result.body_sha256, THREADS1051_SPEC.bodySha256);
    assert.equal(result.visual_decision_id, 282);
    assert.equal(f.providerCalls, 0);
});

test('task1051 exact dry-run and live use the same text-only payload and one idempotent provider call', async () => {
    const f = fixture();
    await releaseThreadsTask1051(releaseArgs, f.deps as never);
    const dry = await f.publication.execute({ projectId: 10, taskId: 1051, dryRun: true }) as unknown as
        { route_executable: boolean; payload_preview: { text: string; has_image: boolean } };
    assert.equal(dry.route_executable, true);
    assert.equal(dry.payload_preview.text, body);
    assert.equal(dry.payload_preview.has_image, false);
    const live = await f.publication.execute({ projectId: 10, taskId: 1051,
        idempotencyKey: 'publish-p10-threads1051-r2-20261011-01' }) as unknown as { published_link: string };
    assert.equal(live.published_link, 'https://www.threads.net/@innokentybo/post/EXACT1051');
    assert.equal(f.providerCalls, 1);
    const replay = await f.publication.execute({ projectId: 10, taskId: 1051,
        idempotencyKey: 'publish-p10-threads1051-r2-20261011-01' }) as unknown as { replayed: boolean };
    assert.equal(replay.replayed, true);
    assert.equal(f.providerCalls, 1);
});

test('task1051 release fails closed on provider duplicate, prior attempt, or wrong identity', async () => {
    const duplicate = fixture();
    duplicate.deps.threads.getOwnPosts = async () => ({ items: [{ text: body }], after: undefined });
    await assert.rejects(releaseThreadsTask1051(releaseArgs, duplicate.deps as never), /THREADS_PROVIDER_DUPLICATE_FOUND/);
    const attempted = fixture(); attempted.attempts.push({ id: 99 });
    await assert.rejects(releaseThreadsTask1051(releaseArgs, attempted.deps as never), /DELIVERY_ATTEMPT_EXISTS/);
    const identity = fixture(); identity.deps.threads.testConnection = async () => ({ success: true,
        details: { id: 'wrong', username: 'wrong' } });
    await assert.rejects(releaseThreadsTask1051(releaseArgs, identity.deps as never), /THREADS_IDENTITY_NOT_VERIFIED/);
});

test('task1051 uncertain live result freezes publishing and creates no fact', async () => {
    const f = fixture();
    await releaseThreadsTask1051(releaseArgs, f.deps as never);
    f.threads.publishPost = async () => { throw new Error('provider timeout'); };
    await assert.rejects(f.publication.execute({ projectId: 10, taskId: 1051,
        idempotencyKey: 'publish-p10-threads1051-r2-uncertain-20261011-01' }), /THREADS_PUBLICATION_UNCERTAIN/);
    assert.equal(f.task.status, 'publishing');
    const report = f.task.quality_report as unknown as { publication_task_delivery: { state: string } };
    assert.equal(report.publication_task_delivery.state, 'provider_result_uncertain');
});
