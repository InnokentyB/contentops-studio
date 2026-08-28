"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const publication_generation_stage_1 = require("../services/publication_generation_stage");
const publication_plan_service_1 = __importDefault(require("../services/publication_plan.service"));
(0, node_test_1.default)('generated weekly topic progresses through the shared publication stages', () => {
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({ status: 'planned' }), 'topic_approval');
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({
        status: 'planned',
        workItems: [{ kind: 'content_write', state: 'available' }]
    }), 'writing');
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({
        status: 'drafted',
        draftText: 'Ready draft',
        workItems: [{ kind: 'content_review', state: 'available' }]
    }), 'content_review');
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({
        status: 'approved',
        draftText: 'Accepted draft',
        workItems: [{ kind: 'art_direction', state: 'available' }]
    }), 'visual_production');
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({
        status: 'ready_for_execution',
        handoffState: 'ready'
    }), 'ready_for_publication');
});
(0, node_test_1.default)('terminal and fallback publication stages take precedence', () => {
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({ status: 'published' }), 'published');
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({ status: 'publishing' }), 'publishing');
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({ status: 'browser_required' }), 'browser_required');
    strict_1.default.equal((0, publication_generation_stage_1.derivePublicationGenerationStage)({ status: 'failed' }), 'failed');
});
(0, node_test_1.default)('only weekly topic items are recognized as generated publication tasks', () => {
    strict_1.default.equal((0, publication_generation_stage_1.isGeneratedPublicationTask)({ item_key: 'week-topic:12:r2:day1', type: 'tg_post' }), true);
    strict_1.default.equal((0, publication_generation_stage_1.isGeneratedPublicationTask)({ item_key: 'week-theme:12:4', type: 'week_theme' }), false);
    strict_1.default.equal((0, publication_generation_stage_1.isGeneratedPublicationTask)({ item_key: 'manual:12', type: 'tg_post' }), false);
});
(0, node_test_1.default)('generated publication handoff uses accepted text and selected visual without an imported plan', () => {
    const bundle = publication_plan_service_1.default.buildGeneratedContentItemHandoff({
        id: 42,
        item_key: 'week-topic:5:r1:day3',
        type: 'tg_post',
        title: 'Тема среды',
        draft_text: 'Полный готовый текст поста',
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
    strict_1.default.equal(bundle.mode, 'automated');
    strict_1.default.equal(bundle.publication.body, 'Полный готовый текст поста');
    strict_1.default.equal(bundle.publication.image_url, 'https://cdn.example/post.png');
    strict_1.default.equal(bundle.task.content_item_id, 42);
});
(0, node_test_1.default)('plan handoff preserves the approved visual bound to the accepted revision', () => {
    const bundle = publication_plan_service_1.default.buildHandoffBundle({
        meta: { plan_id: 'plan-1' },
        accounts: { telegram_main: { platform: 'telegram' } },
        assets: {},
        actions: []
    }, {
        id: 779,
        title: 'Accepted publication',
        draft_text: 'Accepted text',
        accepted_revision: 4,
        selected_asset_id: 91,
        selected_asset: {
            id: 91,
            status: 'approved',
            content_revision: 4,
            file_url: ' https://cdn.example/approved.png ',
            alt_text: 'Approved diagram'
        },
        assets: {
            account_ref: 'telegram_main',
            asset_refs: [],
            action: { id: 'telegram-publish', channel: 'telegram', action_type: 'telegram:publish' }
        }
    });
    strict_1.default.equal(bundle.publication.body, 'Accepted text');
    strict_1.default.equal(bundle.publication.image_url, 'https://cdn.example/approved.png');
    strict_1.default.deepEqual(bundle.publication.visuals, [{
            ref: 'selected_asset',
            asset_id: 91,
            url: 'https://cdn.example/approved.png',
            preview_url: 'https://cdn.example/approved.png',
            alt_text: 'Approved diagram',
            status: 'approved',
            content_revision: 4
        }]);
});
(0, node_test_1.default)('handoff blocks a selected visual that cannot be resolved', () => {
    strict_1.default.throws(() => publication_plan_service_1.default.buildGeneratedContentItemHandoff({
        id: 779,
        draft_text: 'Accepted text',
        accepted_revision: 4,
        selected_asset_id: 91,
        selected_asset: null,
        channel: { type: 'telegram' }
    }), /APPROVED_VISUAL_UNRESOLVABLE/);
    strict_1.default.throws(() => publication_plan_service_1.default.buildGeneratedContentItemHandoff({
        id: 779,
        draft_text: 'Accepted text',
        accepted_revision: 4,
        selected_asset_id: 91,
        selected_asset: { id: 91, status: 'approved', content_revision: 4, file_url: '   ' },
        channel: { type: 'telegram' }
    }), /APPROVED_VISUAL_UNRESOLVABLE/);
});
