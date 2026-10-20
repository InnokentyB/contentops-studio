import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGeneratedContentItemHandoff } from '../services/publication_plan/handoff';
import { publicationPlacementAssetContract } from '../services/publication_placement_contract';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:telegram-native-video-feed';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-only';

const VIDEO_URL = 'https://cdn.example/owner-lecture.mp4';
const VIDEO_SHA = 'b'.repeat(64);

function approvedTelegramVideoTask() {
    return {
        id: 1102,
        project_id: 10,
        channel_id: 109,
        status: 'ready_for_execution',
        publication_mode: 'connector_auto',
        type: 'publication',
        draft_text: 'Accepted native video caption',
        content_revision: 5,
        accepted_revision: 5,
        text_state: 'accepted',
        visual_state: 'APPROVED',
        visual_placement: 'feed',
        selected_asset_id: 186,
        quality_report: {},
        metrics: {},
        published_link: null,
        telegram_message_id: null,
        publication_fact: null,
        channel: {
            id: 109,
            type: 'telegram',
            name: 'analystcraft_tg',
            config: { telegram_channel_id: '-1003986245543', channel_username: 'analystcraft' }
        },
        selected_asset: {
            id: 186,
            status: 'approved',
            content_revision: 5,
            file_url: VIDEO_URL,
            alt_text: 'Owner lecture excerpt',
            provenance: {
                planner_storage: {
                    managed: true,
                    mime_type: 'video/mp4',
                    sha256: VIDEO_SHA,
                    byte_size: 4_827_405
                }
            }
        }
    };
}

test('Telegram feed MP4 has a native video placement contract', () => {
    const contract = publicationPlacementAssetContract(
        { type: 'telegram' },
        'feed',
        { mime_type: 'video/mp4' }
    );

    assert.equal(contract.artifact_kind, 'video');
    assert.deepEqual(contract.accepted_mime_types, ['video/mp4']);
    assert.equal(contract.transport.materialization, 'video');
    assert.equal(contract.transport.connector_authority, 'configured');
});

test('Telegram feed MP4 materializes as publication video instead of image', () => {
    const bundle = buildGeneratedContentItemHandoff(
        approvedTelegramVideoTask(),
        { requireAcceptedContent: true }
    );

    assert.equal(bundle.publication.image_url, null);
    assert.equal(bundle.publication.video_url, VIDEO_URL);
    assert.equal(bundle.task.action_type, 'telegram_video:publish');
    assert.equal(bundle.resource_files[0]?.type, 'video');
    assert.equal(bundle.resource_files[0]?.role, 'publication_video');
    assert.equal(bundle.resource_files[0]?.content_source, 'selected_video_asset');
    assert.equal(bundle.resource_files[0]?.content_type, 'video/mp4');
});

test('Telegram task dry-run exposes the exact native video payload without dispatch', async () => {
    const { TelegramTaskPublicationService } = await import('../services/telegram_task_publication.service');
    const task = approvedTelegramVideoTask();
    let providerCalls = 0;
    const service = new TelegramTaskPublicationService({
        prisma: {
            contentItem: { findFirst: async () => task },
            workflowEvent: { findUnique: async () => null }
        },
        publisher: {
            publishTelegramTaskMtproto: async () => { providerCalls += 1; throw new Error('must not dispatch'); },
            publishTelegramPersonalStoryMtproto: async () => { throw new Error('unexpected story'); },
            publishVkPersonalStory: async () => { throw new Error('unexpected VK story'); },
            publishVkTask: async () => { throw new Error('unexpected VK'); }
        },
        publicationFacts: { record: async () => { throw new Error('must not write'); } }
    });

    const result = await service.execute({ projectId: 10, taskId: 1102, dryRun: true });

    assert.equal(result.route_executable, true);
    assert.equal(result.delivery, 'mtproto');
    assert.deepEqual(result.payload_preview, {
        text: 'Accepted native video caption',
        image_url: null,
        has_image: false,
        video_url: VIDEO_URL,
        has_video: true
    });
    assert.equal(providerCalls, 0);
});
