import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedContentItemHandoff } from '../services/publication_plan/handoff';
process.env.TELEGRAM_BOT_TOKEN ||= 'test:vk-feed-video';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-only';

test('VK video dry-run refuses the legacy photo adapter even when credentials exist', async () => {
    const { TelegramTaskPublicationService } = await import('../services/telegram_task_publication.service');
    const task = {
        id: 1084, project_id: 10, status: 'ready_for_execution', publication_mode: 'connector_auto',
        type: 'vk_post', draft_text: 'Accepted body', text_state: 'accepted', visual_state: 'APPROVED',
        content_revision: 1, accepted_revision: 1, visual_placement: 'feed', selected_asset_id: 118,
        channel: { id: 117, name: 'analystcraft_vk_group', type: 'vk',
            config: { vk_id: '-240051152', publish_access_token: 'fixture-only', user_access_token: 'fixture-only' } },
        selected_asset: { id: 118, status: 'approved', content_revision: 1,
            file_url: 'https://example.com/approved.mp4', provenance: { planner_storage: { mime_type: 'video/mp4' } } }
    };
    const service = new TelegramTaskPublicationService({
        prisma: { contentItem: { findFirst: async () => task } },
        publisher: {} as ConstructorParameters<typeof TelegramTaskPublicationService>[0]['publisher'],
        publicationFacts: { record: async () => { throw new Error('must not write'); } }
    });
    const result = await service.execute({ projectId: 10, taskId: 1084, dryRun: true });
    assert.equal(result.direct_execution_supported, false);
    assert.equal(result.connector_reason, 'vk_native_video_adapter_unsupported');
    assert.equal(result.route_executable, false);
});

test('VK feed MP4 is a video resource without granting automatic authority', () => {
    const bundle = buildGeneratedContentItemHandoff({
        id: 1084, draft_text: 'Accepted body', text_state: 'accepted',
        content_revision: 1, accepted_revision: 1, visual_placement: 'feed',
        channel: { name: 'analystcraft_vk_group', type: 'vk' },
        selected_asset_id: 118,
        selected_asset: { id: 118, status: 'approved', content_revision: 1,
            file_url: 'https://example.com/approved.mp4',
            provenance: { planner_storage: { mime_type: 'video/mp4', width: 1080, height: 1920 } } }
    }, { requireAcceptedContent: true });
    assert.equal(bundle.task.placement, 'feed');
    assert.equal(bundle.task.action_type, 'vk_video:publish');
    assert.equal(bundle.placement_contract.artifact_kind, 'video');
    assert.equal(bundle.transport.connector_authority, 'manual_only');
    assert.equal(bundle.publication.image_url, null);
    assert.equal(bundle.resource_files[0]?.type, 'video');
    assert.equal(bundle.publication.body, 'Accepted body');
});
