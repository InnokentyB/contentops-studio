import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { TelegramTaskPublicationService } from '../services/telegram_task_publication.service';

const text = 'Сначала проблема, потом решение\n\nПолная версия: https://www.youtube.com/shorts/c7ubssjGmSA';
const media = 'https://assets.example/problem-repair-v2.mp4';

function fixture() {
    const task: any = { id: 1099, project_id: 10, channel_id: 108, type: 'telegram_story',
        channel: { id: 108, type: 'telegram', config: { account_ref: 'spherical_analyst_tg' } },
        status: 'ready_for_execution', publication_mode: 'owner_released', content_revision: 1,
        accepted_revision: 1, text_state: 'accepted', draft_text: text, visual_state: 'APPROVED',
        visual_placement: 'story', selected_asset_id: 134, selected_asset: { id: 134, status: 'approved',
            content_revision: 1, file_url: media,
            decision_id: 277, placement: 'story',
            provenance: { sha256: 'ab299952f375cef3346c9a43dc529db1a74ac281dc16f290ab8de0b6cb796c6c',
                source_task_id: 1098, source_asset_id: 133, source_publication_fact_id: 442,
                personal_story_route: true, prohibited_render_job: '6474ed84-5a6a-494d-a06c-7183e9ace9bb',
                owner_uat: 'Прекрасно, можно публиковать' },
            qa_report: { verdict: 'PASS', full_decode: 'PASS', camera_voice_match: 'accepted by owner' } },
        schedule_at: new Date('2026-10-10T13:30:00.000Z'),
        publication_fact: null, published_link: null, quality_report: {} };
    const proof = { task_id: 1099, channel_id: 108, content_revision: 1, accepted_revision: 1,
        schedule_at: task.schedule_at.toISOString(), body_sha256: createHash('sha256').update(text).digest('hex'),
        placement: 'story', publication_mode: 'owner_released', selected_asset_id: 134,
        asset_sha256: 'ab299952f375cef3346c9a43dc529db1a74ac281dc16f290ab8de0b6cb796c6c',
        telegram_account_id: 2, source_story_task_id: 986, source_story_fact_id: 363 };
    let sends = 0; let facts = 0; let event: any = null;
    const db: any = { workflowEvent: { findUnique: async () => event,
        findFirst: async ({ where }: any) => where.command === 'ba_release_telegram_task1099_personal_story'
            ? { after_state: proof } : null,
        create: async ({ data }: any) => { event = { content_item_id: data.content_item_id, after_state: data.after_state }; } },
        contentItem: { findFirst: async () => task, updateMany: async ({ data }: any) => {
            Object.assign(task, data); return { count: 1 }; }, update: async ({ data }: any) => Object.assign(task, data) },
        telegramAccount: { findMany: async () => [{ id: 2, project_id: 10, is_active: true }] },
        projectMember: { findFirst: async () => ({ user_id: 2 }) },
        $transaction: async (run: (tx: any) => unknown) => run(db) };
    const service = new TelegramTaskPublicationService({ prisma: db,
        publisher: { publishTelegramPersonalStoryMtproto: async (payload: any) => {
            sends += 1; assert.equal(payload.caption, text); assert.equal(payload.imageUrl, media);
            assert.deepEqual(payload.mediaMetadata, {
                mimeType: 'video/mp4', width: 1080, height: 1920, durationSeconds: 42.033008
            });
            return { publishedLink: 'https://t.me/InnokentyB/s/55', evidenceRef: 'https://t.me/InnokentyB/s/55',
                metrics: { telegram_story_id: 55 } };
        }, publishTelegramTaskMtproto: async () => assert.fail('channel fallback forbidden'),
        publishVkPersonalStory: async () => assert.fail('VK forbidden'), publishVkTask: async () => assert.fail('VK forbidden') },
        publicationFacts: { record: async () => { facts += 1; } } });
    return { service, task, get sends() { return sends; }, get facts() { return facts; } };
}

test('task1099 dry-run and live use only the personal MTProto video Story route', async () => {
    const f = fixture();
    const dry = await f.service.execute({ projectId: 10, taskId: 1099, dryRun: true });
    assert.equal(dry.delivery, 'mtproto_personal_story');
    assert.equal(dry.target, 'personal_profile');
    assert.equal(dry.payload_preview.image_url, media);
    assert.equal(dry.route_executable, true);
    const args = { projectId: 10, taskId: 1099, idempotencyKey: 'task1099-story-live-v1' };
    await f.service.execute(args); await f.service.execute(args);
    assert.equal(f.sends, 1);
    assert.equal(f.facts, 1);
});
