import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

process.env.TELEGRAM_BOT_TOKEN ||= 'test:telegram-route-repair';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'test-supabase-key';
const { evaluateRepairGuards } = require('../scripts/repair_telegram_connector_route');

const body = 'Accepted Telegram photo post';
const bodySha = createHash('sha256').update(body).digest('hex');
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

test('approved Telegram photo task is eligible for audited connector route repair', () => {
    assert.ok(Object.values(evaluateRepairGuards(fixture())).every(Boolean));
});

test('route repair rejects changed asset, text, decision, publication fact, and unfinished handoff', () => {
    for (const mutation of [
        (f: ReturnType<typeof fixture>) => { f.task.selected_asset_id = 62; },
        (f: ReturnType<typeof fixture>) => { f.task.selected_asset.status = 'candidate'; },
        (f: ReturnType<typeof fixture>) => { f.task.draft_text = 'changed'; },
        (f: ReturnType<typeof fixture>) => { f.decision.status = 'superseded'; },
        (f: ReturnType<typeof fixture>) => { (f.task as any).publication_fact = { outcome: 'published' }; },
        (f: ReturnType<typeof fixture>) => { f.task.handoff_state = 'blocked'; },
        (f: ReturnType<typeof fixture>) => { f.task.selected_asset.file_url = 'http://localhost/image.png'; }
    ]) {
        const input = fixture();
        mutation(input);
        assert.ok(Object.values(evaluateRepairGuards(input)).some((guard) => !guard));
    }
});

test('approval-required Telegram feed cannot be promoted without a documented owner approval', () => {
    const input = fixture();
    input.ownerApprovalRef = '';
    assert.equal(evaluateRepairGuards(input).owner_approval, false);
    input.task.publication_mode = 'manual_handoff';
    input.ownerApprovalRef = 'owner-approved';
    assert.equal(evaluateRepairGuards(input).route, false);
});
