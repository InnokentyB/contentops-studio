import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePublicationGenerationStage, isGeneratedPublicationTask } from '../services/publication_generation_stage';
import publicationPlanService from '../services/publication_plan.service';

test('generated weekly topic progresses through the shared publication stages', () => {
    assert.equal(derivePublicationGenerationStage({ status: 'planned' }), 'topic_approval');
    assert.equal(derivePublicationGenerationStage({
        status: 'planned',
        workItems: [{ kind: 'content_write', state: 'available' }]
    }), 'writing');
    assert.equal(derivePublicationGenerationStage({
        status: 'drafted',
        draftText: 'Ready draft',
        workItems: [{ kind: 'content_review', state: 'available' }]
    }), 'content_review');
    assert.equal(derivePublicationGenerationStage({
        status: 'approved',
        draftText: 'Accepted draft',
        workItems: [{ kind: 'art_direction', state: 'available' }]
    }), 'visual_production');
    assert.equal(derivePublicationGenerationStage({
        status: 'ready_for_execution',
        handoffState: 'ready'
    }), 'ready_for_publication');
});

test('terminal and fallback publication stages take precedence', () => {
    assert.equal(derivePublicationGenerationStage({ status: 'published' }), 'published');
    assert.equal(derivePublicationGenerationStage({ status: 'publishing' }), 'publishing');
    assert.equal(derivePublicationGenerationStage({ status: 'browser_required' }), 'browser_required');
    assert.equal(derivePublicationGenerationStage({ status: 'failed' }), 'failed');
});

test('only weekly topic items are recognized as generated publication tasks', () => {
    assert.equal(isGeneratedPublicationTask({ item_key: 'week-topic:12:r2:day1', type: 'tg_post' }), true);
    assert.equal(isGeneratedPublicationTask({ item_key: 'week-theme:12:4', type: 'week_theme' }), false);
    assert.equal(isGeneratedPublicationTask({ item_key: 'manual:12', type: 'tg_post' }), false);
});

test('generated publication handoff uses accepted text and selected visual without an imported plan', () => {
    const bundle = publicationPlanService.buildGeneratedContentItemHandoff({
        id: 42,
        item_key: 'week-topic:5:r1:day3',
        type: 'tg_post',
        title: 'Тема среды',
        draft_text: 'Полный готовый текст поста',
        content_revision: 3,
        text_state: 'accepted',
        publication_mode: 'automatic',
        accepted_revision: 3,
        schedule_at: new Date('2026-08-26T10:00:00.000Z'),
        channel: { name: 'analysts_thinking_tg', type: 'telegram' },
        selected_asset: {
            id: 7,
            status: 'approved',
            content_revision: 3,
            file_url: 'https://cdn.example/post.png',
            alt_text: 'Схема'
        }
    });

    assert.equal(bundle.mode, 'automated');
    assert.equal(bundle.publication.body, 'Полный готовый текст поста');
    assert.equal(bundle.publication.image_url, 'https://cdn.example/post.png');
    assert.equal(bundle.task.content_item_id, 42);
    assert.equal(bundle.resource_files[0].ref, 'selected_asset');
    assert.equal(bundle.resource_files[0].url, 'https://cdn.example/post.png');
});

test('plan handoff preserves the approved visual bound to the accepted revision', () => {
    const bundle = publicationPlanService.buildHandoffBundle({
        meta: { plan_id: 'plan-1' },
        accounts: { telegram_main: { platform: 'telegram' } },
        assets: {},
        actions: []
    }, {
        id: 779,
        title: 'Accepted publication',
        draft_text: 'Accepted text',
        content_revision: 4,
        text_state: 'accepted',
        accepted_revision: 4,
        selected_asset_id: 91,
        selected_asset: {
            id: 91,
            status: 'approved',
            content_revision: 4,
            file_url: ' https://cdn.example/approved.png ',
            alt_text: 'Approved diagram',
            provenance: {
                source: 'owner',
                planner_storage: {
                    sha256: 'abc123',
                    mime_type: 'image/png',
                    byte_size: 1234,
                    width: 800,
                    height: 600,
                    color_mode: 'RGB',
                    original_file_name: 'source.png'
                }
            }
        },
        assets: {
            account_ref: 'telegram_main',
            asset_refs: [],
            action: { id: 'telegram-publish', channel: 'telegram', action_type: 'telegram:publish' }
        }
    });

    assert.equal(bundle.publication.body, 'Accepted text');
    assert.equal(bundle.publication.image_url, 'https://cdn.example/approved.png');
    assert.deepEqual(bundle.publication.visuals, [{
        ref: 'selected_asset',
        asset_id: 91,
        url: 'https://cdn.example/approved.png',
        preview_url: 'https://cdn.example/approved.png',
        alt_text: 'Approved diagram',
        status: 'approved',
        content_revision: 4,
        checksum_sha256: 'abc123',
        content_type: 'image/png',
        width: 800,
        height: 600,
        provenance: {
            source: 'owner',
            planner_storage: {
                sha256: 'abc123',
                mime_type: 'image/png',
                byte_size: 1234,
                width: 800,
                height: 600,
                color_mode: 'RGB',
                original_file_name: 'source.png'
            }
        }
    }]);
    assert.equal(bundle.publication.content_binding!.accepted_revision, 4);
    assert.equal(bundle.resource_files[0].checksum_sha256, 'abc123');
    assert.equal(bundle.resource_files[0].width, 800);
});

test('plan handoff never substitutes a source brief for the accepted body', () => {
    const bundle = publicationPlanService.buildHandoffBundle({
        meta: { plan_id: 'plan-1' },
        accounts: {},
        assets: {
            source_brief: { type: 'text', content: 'Source brief must not be published' }
        },
        actions: []
    }, {
        id: 868,
        draft_text: 'Exact accepted revision two',
        content_revision: 2,
        accepted_revision: 2,
        text_state: 'accepted',
        assets: {
            asset_refs: ['source_brief'],
            action: { id: 'publish-868', channel: 'telegram', action_type: 'telegram:publish' }
        }
    });
    assert.equal(bundle.publication.body, 'Exact accepted revision two');
    assert.equal(bundle.publication.content_binding!.accepted_revision, 2);
});

test('handoff blocks a selected visual that cannot be resolved', () => {
    assert.throws(() => publicationPlanService.buildGeneratedContentItemHandoff({
        id: 779,
        draft_text: 'Accepted text',
        content_revision: 4,
        text_state: 'accepted',
        accepted_revision: 4,
        selected_asset_id: 91,
        selected_asset: null,
        channel: { type: 'telegram' }
    }), /APPROVED_VISUAL_UNRESOLVABLE/);

    assert.throws(() => publicationPlanService.buildGeneratedContentItemHandoff({
        id: 779,
        draft_text: 'Accepted text',
        content_revision: 4,
        text_state: 'accepted',
        accepted_revision: 4,
        selected_asset_id: 91,
        selected_asset: { id: 91, status: 'approved', content_revision: 4, file_url: '   ' },
        channel: { type: 'telegram' }
    }), /APPROVED_VISUAL_NOT_SERVER_RESOLVABLE/);
});
