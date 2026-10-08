import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';
import { PENDING_THREADS_PACKAGES } from '../services/threads_pending_release.service';

function fixture() {
    const spec = PENDING_THREADS_PACKAGES[1040];
    const date = new Date('2026-10-08T14:30:00Z');
    const task = { id: 1040, project_id: 10, channel_id: 138,
        channel: { type: 'threads', config: { access_token: 'fixture', threads_user_id: 'fixture' } },
        content_revision: 4, accepted_revision: 4, text_state: 'accepted', draft_text: 'Exact short native body',
        visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 2, selected_asset_id: null,
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
        schedule_at: date, publish_at: date, publication_fact: null, published_link: null };
    const proof = { task_id: 1040, channel_id: 138, content_revision: 4, accepted_revision: 4,
        body_sha256: spec.bodySha256, visual_decision_id: 256, publication_authorized: true,
        schedule_at: date.toISOString(), publish_at: date.toISOString() };
    let cached: Record<string, unknown> | null = null;
    let sends = 0;
    const db = {
        contentItem: { findFirst: async () => task,
            updateMany: async ({ where, data }: { where: { status: string }; data: Partial<typeof task> }) => {
                if (task.status !== where.status) return { count: 0 };
                Object.assign(task, data); return { count: 1 };
            }, update: async ({ data }: { data: Partial<typeof task> }) => Object.assign(task, data) },
        workflowEvent: { findUnique: async () => cached ? { after_state: cached } : null,
            findFirst: async () => ({ id: 1, after_state: proof }),
            create: async ({ data }: { data: { after_state: Record<string, unknown> } }) => { cached = data.after_state; } },
        artDirectionDecision: { findFirst: async ({ where }: { where: { id: number; source_content_revision: number } }) => {
            assert.equal(where.id, 256); assert.equal(where.source_content_revision, 4);
            return { id: 256, decision_version: 2 };
        } }, projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (run: (tx: unknown) => unknown): Promise<unknown> => run(db)
    };
    const service = new ThreadsTaskPublicationService({ db, hashBody: () => spec.bodySha256,
        threads: { publishPost: async () => { sends++; return 'https://www.threads.net/@fixture/post/confirmed'; } },
        facts: { record: async () => ({}) } });
    return { service, task, proof, get sends() { return sends; } };
}

test('1040 dry-run supports native route and separate exact send claims once', async () => {
    const f = fixture();
    assert.equal((await f.service.execute({ projectId: 10, taskId: 1040, dryRun: true })).live_publish_supported, true);
    assert.equal(f.sends, 0);
    const args = { projectId: 10, taskId: 1040, idempotencyKey: 'exact-1040-send' };
    await f.service.execute(args); await f.service.execute(args);
    assert.equal(f.sends, 1);
});

test('1040 changed publish_at fails release proof without provider call', async () => {
    const f = fixture(); f.task.publish_at = new Date('2026-10-08T16:30:00Z');
    await assert.rejects(f.service.execute({ projectId: 10, taskId: 1040, idempotencyKey: 'no-send' }), /PROOF_MISMATCH/);
    assert.equal(f.sends, 0);
});
