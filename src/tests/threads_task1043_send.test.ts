import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';

function fixture(fail = false) {
    const body = 'One useful vacancy decision can be valuable once. The harder question is what creates a real reason to return.\n\nSaved evidence? A clearer next step? A new uncertainty? Another vacancy that changes the trade-off?\n\nWe have not observed a repeat-use loop, so I am treating this as a measurement question, not a retention claim.\n\nWhat would make a second visit genuinely useful to you?';
    const task = { id: 1043, project_id: 10, channel_id: 138, channel: { type: 'threads',
        config: { access_token: 'fixture', threads_user_id: '39421253764155091' } },
        content_revision: 5, accepted_revision: 5, text_state: 'accepted', draft_text: body,
        visual_state: 'NO_VISUAL_NEEDED', visual_decision_version: 3, selected_asset_id: null,
        selected_asset: null, status: 'ready_for_execution', handoff_state: 'ready',
        publication_mode: 'owner_released', schedule_at: new Date('2026-10-09T16:30:00Z'),
        publish_at: new Date('2026-10-09T16:30:00Z'), publication_fact: null, published_link: null, quality_report: {} };
    const proof = { task_id: 1043, channel_id: 138, content_revision: 5, accepted_revision: 5,
        body_sha256: 'c68bd80edc8c866930e06844f1f9bde96ab3c4325cf1bd8d21760f1f8fb691bd',
        visual_decision_id: 300, selected_asset_id: null, asset_sha256: null,
        publication_authorized: true, schedule_at: task.schedule_at.toISOString(), publish_at: task.publish_at.toISOString() };
    let sends = 0; let event: Record<string, unknown> | null = null; let facts = 0;
    const db = { contentItem: { findFirst: async () => task,
        updateMany: async ({ where, data }: { where: { status: string }; data: Partial<typeof task> }) => {
            if (task.status !== where.status) return { count: 0 }; Object.assign(task, data); return { count: 1 };
        }, update: async ({ data }: { data: Partial<typeof task> }) => Object.assign(task, data) },
        workflowEvent: { findUnique: async () => event ? { after_state: event } : null,
            findFirst: async () => ({ id: 3000, after_state: proof }),
            create: async ({ data }: { data: { after_state: Record<string, unknown> } }) => { event = data.after_state; } },
        artDirectionDecision: { findFirst: async () => ({ id: 300, decision_version: 3 }) },
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (run: (tx: unknown) => unknown) => run(db) };
    const service = new ThreadsTaskPublicationService({ db,
        hashBody: () => proof.body_sha256,
        threads: { publishPost: async (_u: string, _t: string, sentBody: string, imageUrl?: string) => {
            sends += 1; assert.equal(sentBody, body); assert.equal(imageUrl, undefined);
            if (fail) throw new Error('timeout');
            return 'https://www.threads.net/@innokentybo/post/confirmed1043';
        } }, facts: { record: async () => { facts += 1; } } });
    return { service, task, get sends() { return sends; }, get facts() { return facts; } };
}

test('1043 dry-run and live use the same approved text-only payload and one provider call', async () => {
    const f = fixture();
    const dry = await f.service.execute({ projectId: 10, taskId: 1043, dryRun: true });
    assert.equal(dry.live_publish_supported, true);
    assert.equal(dry.payload_preview.selected_asset_id, null);
    assert.equal(dry.payload_preview.has_image, false);
    assert.equal(dry.payload_preview.text, f.task.draft_text);
    const args = { projectId: 10, taskId: 1043, idempotencyKey: 'exact-1043-send' };
    await f.service.execute(args); await f.service.execute(args);
    assert.equal(f.sends, 1); assert.equal(f.facts, 1);
});

test('1043 uncertain provider result records no fact and cannot auto-retry', async () => {
    const f = fixture(true);
    await assert.rejects(f.service.execute({ projectId: 10, taskId: 1043, idempotencyKey: 'uncertain-1043' }), /UNCERTAIN/);
    assert.equal(f.sends, 1); assert.equal(f.facts, 0); assert.equal(f.task.status, 'publishing');
    await assert.rejects(f.service.execute({ projectId: 10, taskId: 1043, idempotencyKey: 'retry-1043' }), /PROOF_MISMATCH/);
    assert.equal(f.sends, 1);
});
