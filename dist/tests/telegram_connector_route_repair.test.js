"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = __importDefault(require("node:test"));
(_a = process.env).TELEGRAM_BOT_TOKEN || (_a.TELEGRAM_BOT_TOKEN = 'test:telegram-route-repair');
(_b = process.env).SUPABASE_URL || (_b.SUPABASE_URL = 'https://example.supabase.co');
(_c = process.env).SUPABASE_KEY || (_c.SUPABASE_KEY = 'test-supabase-key');
const { evaluateRepairGuards } = require('../scripts/repair_telegram_connector_route');
const body = 'Accepted Telegram photo post';
const bodySha = (0, node_crypto_1.createHash)('sha256').update(body).digest('hex');
function fixture() {
    const decision = { id: 107, decision: 'GENERATE', status: 'active', source_content_revision: 1 };
    const task = {
        id: 933, project_id: 10, channel_id: 108, channel: { type: 'telegram' },
        status: 'browser_required', publication_mode: 'approval_required',
        publication_fact: null, draft_text: body, content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', handoff_state: 'ready', visual_state: 'APPROVED',
        selected_asset_id: 61,
        selected_asset: { id: 61, project_id: 10, content_item_id: 933,
            content_revision: 1, decision_id: 107, status: 'approved',
            file_url: 'https://cdn.example.com/approved.png' }
    };
    const input = { task, decision, projectId: 10, taskId: 933,
        expectedRevision: 1, expectedChannelId: 108, expectedDecisionId: 107,
        expectedAssetId: 61, expectedBodySha: bodySha,
        ownerApprovalRef: 'owner-approved:task-933-2026-09-18' };
    return input;
}
(0, node_test_1.default)('approved Telegram photo task is eligible for audited connector route repair', () => {
    strict_1.default.ok(Object.values(evaluateRepairGuards(fixture())).every(Boolean));
});
(0, node_test_1.default)('route repair rejects changed asset, text, decision, publication fact, and unfinished handoff', () => {
    for (const mutation of [
        (f) => { f.task.selected_asset_id = 62; },
        (f) => { f.task.selected_asset.status = 'candidate'; },
        (f) => { f.task.draft_text = 'changed'; },
        (f) => { f.decision.status = 'superseded'; },
        (f) => { f.task.publication_fact = { outcome: 'published' }; },
        (f) => { f.task.handoff_state = 'blocked'; },
        (f) => { f.task.selected_asset.file_url = 'http://localhost/image.png'; }
    ]) {
        const input = fixture();
        mutation(input);
        strict_1.default.ok(Object.values(evaluateRepairGuards(input)).some((guard) => !guard));
    }
});
(0, node_test_1.default)('approval-required Telegram feed cannot be promoted without a documented owner approval', () => {
    const input = fixture();
    input.ownerApprovalRef = '';
    strict_1.default.equal(evaluateRepairGuards(input).owner_approval, false);
    input.task.publication_mode = 'manual_handoff';
    input.ownerApprovalRef = 'owner-approved';
    strict_1.default.equal(evaluateRepairGuards(input).route, false);
});
