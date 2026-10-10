import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';

const BODY_SHA = 'e3403bd77725ff503627cdecca3a2ce423f148af75ac25830add9652ae25adb9';
const ASSET_SHA = '1b9177bbdc77a4d29f0c950f14f85f16f018c2a45544aa8f75ff6e8f00db2e03';
const IMAGE_URL = 'https://assets.example/task1046.png';

function fixture(fail = false) {
    const task = { id: 1046, project_id: 10, channel_id: 138, channel: { type: 'threads',
        config: { access_token: 'fixture', threads_user_id: '39421253764155091' } },
        content_revision: 4, accepted_revision: 4, text_state: 'accepted', draft_text: 'exact body',
        visual_state: 'APPROVED', visual_placement: 'feed', visual_decision_version: 1, selected_asset_id: 132,
        selected_asset: { id: 132, status: 'approved', content_revision: 4, file_url: IMAGE_URL,
            provenance: { planner_storage: { managed: true, sha256: ASSET_SHA } } },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
        schedule_at: new Date('2026-10-10T16:30:00Z'), publish_at: new Date('2026-10-10T16:30:00Z'),
        publication_fact: null, published_link: null, quality_report: {} };
    const proof = { task_id: 1046, channel_id: 138, content_revision: 4, accepted_revision: 4,
        body_sha256: BODY_SHA, visual_decision_id: 270, selected_asset_id: 132, asset_sha256: ASSET_SHA,
        publication_authorized: true, schedule_at: task.schedule_at.toISOString(), publish_at: task.publish_at.toISOString() };
    let sends = 0; let event: Record<string, unknown> | null = null; let facts = 0;
    const db = { contentItem: { findFirst: async () => task,
        updateMany: async ({ where, data }: { where: { status: string }; data: Partial<typeof task> }) => {
            if (task.status !== where.status) return { count: 0 }; Object.assign(task, data); return { count: 1 };
        }, update: async ({ data }: { data: Partial<typeof task> }) => Object.assign(task, data) },
        workflowEvent: { findUnique: async () => event ? { after_state: event } : null,
            findFirst: async () => ({ id: 3100, after_state: proof }),
            create: async ({ data }: { data: { after_state: Record<string, unknown> } }) => { event = data.after_state; } },
        artDirectionDecision: { findFirst: async () => ({ id: 270, decision_version: 1 }) },
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (run: (tx: unknown) => unknown) => run(db) };
    const service = new ThreadsTaskPublicationService({ db, hashBody: () => BODY_SHA,
        threads: { publishPost: async (_u: string, _t: string, sentBody: string, imageUrl?: string) => {
            sends += 1; assert.equal(sentBody, task.draft_text); assert.equal(imageUrl, IMAGE_URL);
            if (fail) throw new Error('timeout');
            return 'https://www.threads.net/@innokentybo/post/confirmed1046';
        } }, facts: { record: async () => { facts += 1; } } });
    return { service, task, get sends() { return sends; }, get facts() { return facts; } };
}

test('1046 dry-run and live share the approved task-native image payload', async () => {
    const f = fixture();
    const dry = await f.service.execute({ projectId: 10, taskId: 1046, dryRun: true });
    assert.equal(dry.live_publish_supported, true);
    assert.equal(dry.payload_preview.text, f.task.draft_text);
    assert.equal(dry.payload_preview.has_image, true);
    assert.equal(dry.payload_preview.selected_asset_id, 132);
    assert.equal(dry.payload_preview.image_url, IMAGE_URL);
    const args = { projectId: 10, taskId: 1046, idempotencyKey: 'exact-1046-send' };
    await f.service.execute(args); await f.service.execute(args);
    assert.equal(f.sends, 1);
    assert.equal(f.facts, 1);
});

test('1046 uncertain provider result records no fact and freezes any retry', async () => {
    const f = fixture(true);
    await assert.rejects(f.service.execute({ projectId: 10, taskId: 1046, idempotencyKey: 'uncertain-1046' }), /UNCERTAIN/);
    assert.equal(f.sends, 1);
    assert.equal(f.facts, 0);
    assert.equal(f.task.status, 'publishing');
    await assert.rejects(f.service.execute({ projectId: 10, taskId: 1046, idempotencyKey: 'retry-1046' }), /PROOF_MISMATCH/);
    assert.equal(f.sends, 1);
});
