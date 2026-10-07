import assert from 'node:assert/strict';
import test from 'node:test';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';

test('exact accepted Threads 1035 advertises native live support without sending', async () => {
    let sends = 0;
    const service = new ThreadsTaskPublicationService({
        db: { contentItem: { findFirst: async () => ({
            channel_id: 138, channel: { type: 'threads', config: { access_token: 'test-token', threads_user_id: 'test-user' } },
            accepted_revision: 1, content_revision: 1, text_state: 'accepted', draft_text: 'Accepted post',
            selected_asset_id: null, schedule_at: new Date('2026-10-07T16:30:00.000Z')
        }) } },
        threads: { publishPost: async () => { sends += 1; } }
    });
    const result = await service.execute({ projectId: 10, taskId: 1035, dryRun: true });
    assert.equal(result.live_publish_supported, true);
    assert.equal(sends, 0);
    await assert.rejects(service.execute({ projectId: 29, taskId: 1035, idempotencyKey: 'wrong-tenant' }), /THREADS_TASK_SCOPE_MISMATCH/);
    assert.equal(sends, 0);
});
