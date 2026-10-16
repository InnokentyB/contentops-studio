const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { repairReviewHandoff, reviewRepairMetadataHash, reviewRepairStateHash } = require('../../dist/services/review_handoff_repair');
const sha = value => createHash('sha256').update(value).digest('hex');
const date = '2026-10-16T14:00:00.000Z';
const args = { projectId: 7, taskId: 1136, workItemId: 1948, actorId: 'user:2',
    expectedChannelId: 6, expectedRevision: 2, expectedBodySha256: sha('same body'),
    expectedScheduleAt: date, expectedPublishAt: date, expectedResultVersion: 2,
    expectedChannelConfigSha256: sha(JSON.stringify({ execution_modes: ['manual'] })),
    idempotencyKey: 'test-repair', reason: 'Owner-authorized review and metadata recovery', apply: false };
function fixture() {
    let state = { task: { id: 1136, project_id: 7, channel_id: 6, content_revision: 2,
        accepted_revision: null, draft_text: 'same body', status: 'drafted', text_state: 'draft',
        visual_state: 'STALE', visual_placement: 'feed', selected_asset_id: null,
        publication_mode: 'approval_required', schedule_at: new Date(date), publish_at: new Date(date),
        published_link: null, publication_fact: null, quality_report: { preserved: 'history',
            handoff_bundle: { mode: 'automated' } }, channel: { id: 6, project_id: 7, type: 'linkedin',
                name: 'seturon_linkedin_page', config: { execution_modes: ['manual'] } } },
        review: { id: 1948, project_id: 7, content_item_id: 1136, kind: 'content_review',
            state: 'waiting_approval', assignee_role: 'content_reviewer', input_context_version: 2,
            result_version: 2, result_payload: { content_revision: 2, body: 'same body' },
            lease_token: null, lease_actor_id: null, item_key: 'slot', due_at: new Date(date),
            note: 'Historical review note', reason_code: 'HISTORICAL_REASON' },
        approval: { id: 368, decision: 'approved', result_version: 2 }, replacements: [], events: [],
        attempts: 0, owner: true, failAudit: false };
    const db = {
        projectMember: { findUnique: async () => ({ role: state.owner ? 'owner' : 'editor' }) },
        contentItem: { findFirst: async () => state.task, updateMany: async ({ data }) => {
            Object.assign(state.task, data); return { count: 1 }; } },
        workItem: { findFirst: async () => state.review, count: async () => 0,
            updateMany: async ({ where, data }) => { if (state.review.state !== where.state) return { count: 0 };
                Object.assign(state.review, data); return { count: 1 }; },
            create: async ({ data }) => { const r = { id: 2000, ...data }; state.replacements.push(r); return r; } },
        approvalDecision: { findUnique: async () => state.approval },
        deliveryAttempt: { count: async () => state.attempts },
        workflowEvent: { findUnique: async () => state.events[0] || null,
            create: async ({ data }) => { if (state.failAudit) throw Error('audit unavailable');
                const e = { id: 4000, ...data }; state.events.push(e); return e; } },
        $transaction: async run => { const before = structuredClone(state); try { return await run(db); }
            catch (e) { state = before; throw e; } }
    };
    return { db, get state() { return state; } };
}
const reference = fixture().state;
args.expectedTaskMetadataSha256 = reviewRepairMetadataHash(reference.task);
args.expectedReviewStateSha256 = reviewRepairStateHash(reference.review);
test('preview has no writes or approval', async () => {
    const f = fixture(); const before = structuredClone(f.state);
    const r = await repairReviewHandoff(args, f.db);
    assert.equal(r.mode, 'preview'); assert.deepEqual(f.state, before);
});
test('repair preserves immutable review/approval and body, replaces review at result0 and manual handoff atomically', async () => {
    const f = fixture(); const before = structuredClone(f.state);
    const r = await repairReviewHandoff({ ...args, apply: true }, f.db);
    assert.equal(r.replacement_work_item_id, 2000);
    assert.equal(f.state.review.state, 'completed');
    assert.deepEqual(f.state.review.result_payload, before.review.result_payload);
    assert.equal(f.state.review.note, before.review.note);
    assert.equal(f.state.review.reason_code, before.review.reason_code);
    assert.deepEqual(f.state.approval, before.approval);
    assert.equal(f.state.task.draft_text, before.task.draft_text);
    assert.equal(f.state.task.accepted_revision, null);
    assert.equal(f.state.task.publication_mode, 'approval_required');
    assert.equal(f.state.task.quality_report.preserved, 'history');
    assert.equal(f.state.task.quality_report.handoff_bundle.mode, 'manual');
    assert.equal(f.state.task.quality_report.handoff_bundle.transport.connector_authority, 'manual_only');
    assert.equal(f.state.replacements[0].result_version, 0);
    assert.equal(f.state.replacements[0].input_context_version, 2);
    assert.equal(f.state.replacements[0].state, 'available');
    assert.equal(f.state.attempts, 0);
});
test('same key replays one replacement; changed key payload is rejected', async () => {
    const f = fixture(); const input = { ...args, apply: true };
    await repairReviewHandoff(input, f.db);
    assert.equal((await repairReviewHandoff(input, f.db)).replayed, true);
    assert.equal(f.state.replacements.length, 1);
    await assert.rejects(repairReviewHandoff({ ...input, expectedRevision: 3 }, f.db), /IDEMPOTENCY/);
});
test('owner/tenant/body/revision/config/fact/attempt/lease drift fail before mutation', async () => {
    for (const mutate of [f => f.state.owner = false, f => f.state.task.project_id = 8,
        f => f.state.task.draft_text = 'drift', f => f.state.task.content_revision = 3,
        f => f.state.task.channel.config.execution_modes = ['automated'],
        f => f.state.task.quality_report.identity_binding = { linkedin_company_id: 'foreign' },
        f => f.state.review.note = 'Changed review',
        f => f.state.task.publication_fact = { id: 1 }, f => f.state.attempts = 1,
        f => f.state.review.lease_actor_id = 'active-editor']) {
        const f = fixture(); mutate(f); const before = structuredClone(f.state);
        await assert.rejects(repairReviewHandoff({ ...args, apply: true }, f.db));
        assert.deepEqual(f.state, before);
    }
});
test('audit failure rolls back review supersession, replacement, projection', async () => {
    const f = fixture(); f.state.failAudit = true; const before = structuredClone(f.state);
    await assert.rejects(repairReviewHandoff({ ...args, apply: true }, f.db), /audit unavailable/);
    assert.deepEqual(f.state, before);
});
