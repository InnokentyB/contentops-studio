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
        publication_mode: 'automatic',
        schedule_at: new Date('2026-08-26T10:00:00.000Z'),
        channel: { name: 'analysts_thinking_tg', type: 'telegram' },
        selected_asset: { file_url: 'https://cdn.example/post.png', alt_text: 'Схема' }
    });

    assert.equal(bundle.mode, 'automated');
    assert.equal(bundle.publication.body, 'Полный готовый текст поста');
    assert.equal(bundle.publication.image_url, 'https://cdn.example/post.png');
    assert.equal(bundle.task.content_item_id, 42);
});
