const test = require('node:test');
const assert = require('node:assert/strict');
test('rev3 exact controls are discoverable only by owner and Publisher', () => {
    const { isToolAllowedForProfile } = require('../../dist/mcp/capabilities');
    for (const name of ['ba_release_linkedin_task1128_rev3_browser', 'ba_claim_linkedin_task1128_rev3_browser',
        'ba_renew_linkedin_task1128_rev3_browser_lease', 'ba_start_linkedin_task1128_rev3_browser_submission',
        'ba_pre_submit_linkedin_task1128_rev3_browser_submission', 'ba_confirm_linkedin_task1128_rev3_browser_submission',
        'ba_reconcile_linkedin_task1128_rev3_browser_submission', 'ba_mark_linkedin_task1128_rev3_browser_submission_uncertain']) {
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        assert.equal(isToolAllowedForProfile('owner', name), true);
        assert.equal(isToolAllowedForProfile('writer', name), false);
    }
});
test('1128 generic manual fact cannot bypass the replacement attempt', async () => {
    const { guardManualPublicationFact } = require('../../dist/services/publication_manual_fact_guard');
    await assert.rejects(guardManualPublicationFact({ workflowEvent: { findFirst: async () => null }, connectorDispatchJob: { findFirst: async () => null }, contentItem: { findFirst: async () => null } }, { projectId: 7, taskId: 1128, internalConfirmation: false }), /LINKEDIN1128_EXACT_CONFIRMATION_REQUIRED/);
});
function feature() {
    let value;
    try { value = require('../../dist/services/linkedin1128_rev3_contract'); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    assert.equal(typeof value?.assertRev1PreProvider, 'function', 'audited English supersede policy must exist');
    return value;
}
const snapshot = () => ({ actor: 'user:2', work: { id: 1924, state: 'claimed', input_context_version: 1, lease_actor_id: 'user:2' },
    attempts: [{ id: 38, channel_id: 6, status: 'pending', actual_published_at: null,
        requires_manual_confirmation: true, idempotency_key: 'start-linkedin-p7-1128-wi1924-20261015-01' }],
    events: [{ id: 3243, actor_id: 'user:2', work_item_id: 1924, command: 'ba_start_linkedin_task1128_browser_submission',
        idempotency_key: 'start-linkedin-p7-1128-wi1924-20261015-01', after_state: { attempt_id: 38 } }] });
test('1128 English replacement allows only the exact pending pre-submit-free old attempt', () => {
    assert.doesNotThrow(() => feature().assertRev1PreProvider(snapshot()));
});
test('1128 any Submit permission, ambiguity, delivery or extra attempt forbids pre-provider abort', () => {
    for (const mutate of [s => s.events.push({ command: 'ba_pre_submit_linkedin_task1128_browser_submission' }),
        s => { s.attempts[0].status = 'verification_required'; }, s => { s.attempts[0].actual_published_at = '2026-10-15T11:40:00Z'; },
        s => s.attempts.push({ id: 39 }), s => { s.work.lease_actor_id = 'user:3'; }]) {
        const s = snapshot(); mutate(s);
        assert.throws(() => feature().assertRev1PreProvider(s), /RECONCILIATION_REQUIRED/);
    }
});
