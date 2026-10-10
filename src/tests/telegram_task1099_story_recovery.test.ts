import test from 'node:test';
import assert from 'node:assert/strict';
import {
    repairTelegramTask1099Story,
    releaseTelegramTask1099Story,
    TELEGRAM1099_MANIFEST_CHECKSUM
} from '../services/telegram_task1099_story_recovery.service';

const BODY_SHA = 'f46104f5ed4e1b892d07eb1474015890165bc61a3d9bd0c7bce3edc061f2a2be';
const MEDIA_SHA = 'ab299952f375cef3346c9a43dc529db1a74ac281dc16f290ab8de0b6cb796c6c';
const MEDIA_URL = `https://assets.example/${MEDIA_SHA}.mp4`;

const repairArgs = { projectId: 10, taskId: 1099, actorId: 'user:2',
    expectedManifestChecksum: TELEGRAM1099_MANIFEST_CHECKSUM, idempotencyKey: 'repair-1099-story-v1' } as const;
const releaseArgs = { ...repairArgs, idempotencyKey: 'release-1099-story-v1',
    approvalReference: 'Owner accepted problem-repair-v2 for personal Telegram Story' } as const;

function fixture() {
    const task: any = { id: 1099, project_id: 10, channel_id: 108, type: 'publication',
        channel: { id: 108, project_id: 10, type: 'telegram', name: 'spherical_analyst_tg', is_active: true,
            config: { account_ref: 'spherical_analyst_tg' } }, status: 'ready_for_execution',
        publication_mode: 'approval_required', content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', draft_text: 'accepted caption', visual_mode: 'auto_assess',
        visual_state: 'APPROVED', visual_placement: 'feed', visual_decision_version: 1,
        selected_asset_id: 134, selected_asset: { id: 134, project_id: 10, content_item_id: 1099,
            decision_id: 277, content_revision: 1, placement: 'story', asset_version: 1, status: 'approved',
            file_url: MEDIA_URL, provenance: { sha256: MEDIA_SHA, source_task_id: 1098, source_asset_id: 133,
                source_publication_fact_id: 442, personal_story_route: true,
                owner_uat: 'accepted after full playback 2026-10-10: «Прекрасно, можно публиковать»',
                prohibited_render_job: '6474ed84-5a6a-494d-a06c-7183e9ace9bb' },
            qa_report: { verdict: 'PASS', full_decode: 'PASS', camera_voice_match: 'accepted by owner',
                file_sha256: MEDIA_SHA, prohibited_render_job: '6474ed84-5a6a-494d-a06c-7183e9ace9bb' } },
        handoff_state: 'ready', schedule_at: new Date('2026-10-10T13:30:00.000Z'),
        publish_at: new Date('2026-10-10T13:30:00.000Z'), assets: { initiative_key: 'ANALYSTCRAFT-TG-STORY-20261010-VIDEO-01' },
        quality_report: { execution_mode: 'assisted', initiative_key: 'ANALYSTCRAFT-TG-STORY-20261010-VIDEO-01' },
        metrics: null, publication_fact: null, published_link: null, telegram_message_id: null };
    const events = new Map<string, any>();
    let attempt = false;
    let activeAccounts = [{ id: 2, project_id: 10, is_active: true }];
    const sourceAsset = { id: 133, project_id: 10, content_item_id: 1098, status: 'approved',
        file_url: MEDIA_URL, provenance: { planner_storage: { managed: true, sha256: MEDIA_SHA, mime_type: 'video/mp4' } } };
    const tx: any = {
        project: { findUnique: async () => ({ id: 10, slug: 'analystcraft-2' }) },
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        initiative: { findUnique: async () => ({ id: 296, project_id: 10,
            external_key: 'ANALYSTCRAFT-TG-STORY-20261010-VIDEO-01', kind: 'publication', subtype: 'telegram_story',
            due_at: new Date('2026-10-10T13:30:00.000Z') }) },
        workflowEvent: {
            findFirst: async ({ where }: any) => where.idempotency_key
                ? events.get(`${where.command}:${where.idempotency_key}`) || null
                : [...events.values()].find(event => event.command === where.command) || null,
            create: async ({ data }: any) => { events.set(`${data.command}:${data.idempotency_key}`, data); return data; }
        },
        contentItem: { findFirst: async ({ where }: any) => where.id === 986
            ? { id: 986, project_id: 10, channel_id: 108, type: 'telegram_story', status: 'published',
                publication_fact: { id: 363, outcome: 'published', public_url: 'https://t.me/InnokentyB/s/54', provider_object_id: '54' },
                quality_report: { publication_task_delivery: { state: 'provider_confirmed', delivery: 'mtproto_personal_story' } } }
            : task,
            updateMany: async ({ where, data }: any) => {
                if (where.type && where.type !== task.type) return { count: 0 };
                if (where.visual_placement && where.visual_placement !== task.visual_placement) return { count: 0 };
                if (where.publication_mode && where.publication_mode !== task.publication_mode) return { count: 0 };
                Object.assign(task, data); return { count: 1 };
            } },
        artDirectionDecision: { findUnique: async () => ({ id: 277, project_id: 10, content_item_id: 1099,
            work_item_id: 1720, decision_version: 1, source_content_revision: 1, channel: 'telegram',
            placement: 'story', decision: 'MANUAL_ASSET_REQUIRED', status: 'active' }) },
        imageAsset: { findUnique: async ({ where }: any) => where.id === 133 ? sourceAsset : task.selected_asset },
        publicationFact: { findUnique: async ({ where }: any) => where.id === 442
            ? { id: 442, project_id: 10, content_item_id: 1098, outcome: 'published',
                public_url: 'https://www.youtube.com/shorts/c7ubssjGmSA', provider_object_id: 'c7ubssjGmSA' }
            : null },
        workItem: { findUnique: async ({ where }: any) => where.id === 1720
            ? { id: 1720, project_id: 10, content_item_id: 1099, kind: 'art_direction', state: 'completed', input_context_version: 1, result_version: 1 }
            : where.id === 1721 ? { id: 1721, project_id: 10, content_item_id: 1099,
                kind: 'visual_source_collect', state: 'blocked', reason_code: 'MANUAL_ASSET_REQUIRED', input_context_version: 1 } : null },
        deliveryAttempt: { findFirst: async () => attempt ? { id: 1 } : null },
        telegramAccount: { findMany: async () => activeAccounts }
    };
    const database = { ...tx, $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
    const deps: any = { database, manifestLoader: async () => ({ checksum: TELEGRAM1099_MANIFEST_CHECKSUM }),
        hashBody: () => BODY_SHA, now: () => new Date('2026-10-10T15:45:00.000Z') };
    return { task, events, deps, addAttempt: () => { attempt = true; },
        driftSession: () => { activeAccounts = [{ id: 3, project_id: 10, is_active: true }]; } };
}

test('task1099 exact correction changes only subtype placement and derived routing', async () => {
    const f = fixture();
    const immutable = { body: f.task.draft_text, revision: f.task.content_revision,
        asset: f.task.selected_asset_id, schedule: f.task.schedule_at.toISOString() };
    const result = await repairTelegramTask1099Story(repairArgs, f.deps);
    assert.equal(result.type, 'telegram_story');
    assert.equal(result.visual_placement, 'story');
    assert.equal(result.published, false);
    assert.equal(f.task.assets.action.action_type, 'telegram_story:publish');
    assert.equal(f.task.assets.account_ref, 'spherical_analyst_tg');
    assert.deepEqual({ body: f.task.draft_text, revision: f.task.content_revision,
        asset: f.task.selected_asset_id, schedule: f.task.schedule_at.toISOString() }, immutable);
    assert.equal(f.task.publication_fact, null);
});

test('task1099 owner release binds account2 and task986 proof without publishing', async () => {
    const f = fixture();
    await repairTelegramTask1099Story(repairArgs, f.deps);
    const result = await releaseTelegramTask1099Story(releaseArgs, f.deps);
    const replay = await releaseTelegramTask1099Story(releaseArgs, f.deps);
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.telegram_account_id, 2);
    assert.equal(result.source_story_task_id, 986);
    assert.equal(result.source_story_fact_id, 363);
    assert.equal(result.published, false);
    assert.equal(replay.replayed, true);
    assert.equal(f.task.publication_mode, 'owner_released');
    assert.equal(f.task.publication_fact, null);
});

for (const blocker of ['fact', 'attempt', 'session', 'render'] as const) {
    test(`task1099 recovery fails closed on ${blocker}`, async () => {
        const f = fixture();
        if (blocker === 'fact') f.task.publication_fact = { id: 999 };
        if (blocker === 'attempt') f.addAttempt();
        if (blocker === 'session') f.driftSession();
        if (blocker === 'render') f.task.selected_asset.provenance.prohibited_render_job = 'wrong';
        if (blocker === 'session') await repairTelegramTask1099Story(repairArgs, f.deps);
        const action = blocker === 'session'
            ? releaseTelegramTask1099Story(releaseArgs, f.deps)
            : repairTelegramTask1099Story(repairArgs, f.deps);
        await assert.rejects(action, /FACT_EXISTS|DELIVERY_ATTEMPT_EXISTS|SESSION_BINDING_MISMATCH|PACKAGE_CHANGED/);
        assert.equal(f.task.publication_mode, 'approval_required');
    });
}
