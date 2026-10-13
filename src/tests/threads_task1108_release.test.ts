import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { PENDING_THREADS_PACKAGES } from '../services/threads_pending_release.service';
import { ThreadsTaskPublicationService } from '../services/threads_task_publication.service';

const BODY_SHA = 'b7d8b317537dce0cc347258574101de75f3cc3d5aee131c1d1c62c4e12448feb';

test('task1108 release binds the exact accepted package and owner-only command', () => {
    assert.deepEqual(PENDING_THREADS_PACKAGES[1108], {
        revision: 1,
        decisionId: 290,
        decisionChannel: 'threads',
        chain: false,
        bodySha256: BODY_SHA,
        releaseCommand: 'ba_release_threads_task1108_api',
        schedule: '2026-10-12T16:30:00.000Z'
    });
    for (const tool of ['ba_release_threads_task1108_api', 'ba_publish_threads_task1108']) {
        assert.equal(isToolAllowedForProfile('owner', tool), true);
        assert.equal(isToolAllowedForProfile('publisher', tool), true);
        assert.equal(isToolAllowedForProfile('planner', tool), false);
        assert.equal(isToolAllowedForProfile('writer', tool), false);
    }
});

test('task1108 dry-run reports the task-native live route and exact payload', async () => {
    const body = 'I changed a channel plan, but the old decision stayed coherent inside another conversation.';
    const service = new ThreadsTaskPublicationService({
        db: { contentItem: { findFirst: async () => ({
            id: 1108,
            project_id: 10,
            channel_id: 138,
            channel: { type: 'threads', config: {
                access_token: 'fixture',
                threads_user_id: '39421253764155091'
            } },
            accepted_revision: 1,
            content_revision: 1,
            text_state: 'accepted',
            draft_text: body,
            selected_asset_id: null,
            visual_state: 'NO_VISUAL_NEEDED',
            visual_decision_version: 1,
            schedule_at: new Date('2026-10-12T16:30:00.000Z')
        }) } }
    });

    const result = await service.execute({ projectId: 10, taskId: 1108, dryRun: true }) as {
        route_executable: boolean;
        live_publish_supported: boolean;
        payload_preview: { text: string; accepted_revision: number; selected_asset_id: null };
    };
    assert.equal(result.route_executable, true);
    assert.equal(result.live_publish_supported, true);
    assert.equal(result.payload_preview.text, body);
    assert.equal(result.payload_preview.accepted_revision, 1);
    assert.equal(result.payload_preview.selected_asset_id, null);
});
