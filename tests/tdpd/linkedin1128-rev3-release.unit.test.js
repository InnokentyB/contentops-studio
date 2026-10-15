const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const core = require('../../dist/services/linkedin1128_rev3_guard');
const policy = require('../../dist/services/linkedin1128_release_policy');
const { LINKEDIN1128R3: p } = require('../../dist/services/linkedin1128_rev3_contract');
const old = require('../../dist/services/linkedin1128_identity.service').LINKEDIN1128;
const { releaseLinkedIn1128Rev3 } = require('../../dist/services/linkedin1128_rev3_release');
const args = { projectId: 7, taskId: 1128, channelId: 6, actorId: 'user:2', approvalReference: 'synthetic owner English replacement',
    expectedManifestChecksum: p.manifest, idempotencyKey: 'synthetic-r3-release', contentRevision: 3, textSha256: p.body,
    selectedAssetId: null, imageSha256: null, expectedOldAttemptId: 38, expectedOldWorkItemId: 1924,
    noSubmitEvidenceReference: 'synthetic stopped executor report' };
function fixture(t, fail = false) {
    let prior = null; const writes = []; let audits = 0;
    const binding = { actor_id: 'user:2', audit_idempotency_key: 'synthetic-old-binding', content_revision: 1,
        linkedin_company_id: '97416172', canonical_url: 'https://www.linkedin.com/company/seturon/', provider_identity_verified: false };
    const work = { id: 1924, state: 'claimed', input_context_version: 1, lease_actor_id: 'user:2',
        lease_token: 'synthetic-old-private-fence', lease_expires_at: new Date('2026-10-15T12:00:00Z'), updated_at: new Date() };
    const task = { status: 'ready_for_execution', updated_at: new Date(), draft_text: require('../fixtures/linkedin1128-rev3-body'),
        quality_report: { identity_binding: binding, owner_release: { body_sha256: old.body } }, schedule_at: new Date(p.schedule) };
    t.mock.method(core, 'check1128Rev3Owner', async () => undefined);
    t.mock.method(core, 'rev3Package', async () => task);
    t.mock.method(policy, 'linkedIn1128Binding', () => binding);
    const tx = { deliveryAttempt: { findMany: async () => [{ id: 38, channel_id: 6, status: 'pending',
        actual_published_at: null, requires_manual_confirmation: true, idempotency_key: p.oldAttemptKey, updated_at: new Date() }],
        updateMany: async ({ data }) => { writes.push('old-attempt'); assert.equal(data.status, 'superseded_pre_provider');
            assert.equal(data.actual_published_at, undefined); return { count: fail ? 0 : 1 }; } },
        workItem: { findFirst: async ({ where }) => where.id === 1924 ? work : null,
            updateMany: async ({ data }) => { writes.push('old-work'); assert.equal(data.state, 'blocked');
                assert.equal(data.lease_token, null); assert.equal(data.result_payload, undefined); return { count: 1 }; },
            create: async ({ data }) => { writes.push('new-work'); assert.equal(data.input_context_version, 3); return { id: 2001 }; } },
        contentItem: { updateMany: async ({ data }) => { writes.push('task-projection');
            assert.deepEqual(Object.keys(data).sort(), ['quality_report', 'status']);
            assert.equal(data.quality_report.handoff_bundle.content_language, 'en');
            assert.equal(data.quality_report.handoff_bundle.publication.body, task.draft_text); return { count: 1 }; } },
        workflowEvent: { findFirst: async ({ where }) => where.command === p.command ? prior : where.command === old.command
            ? { after_state: { applied: true, identity_binding: binding } }
            : { actor_id: 'user:2', after_state: { browser_work_item_id: 1924, body_sha256: old.body } },
            findMany: async () => [{ id: 3243, command: 'ba_start_linkedin_task1128_browser_submission', actor_id: 'user:2',
                work_item_id: 1924, idempotency_key: p.oldAttemptKey, after_state: { attempt_id: 38 } }],
            create: async ({ data }) => { audits += 1; prior = data;
                assert.ok(!JSON.stringify(data).includes(work.lease_token)); assert.equal(data.before_state.start_event_id, 3243); } } };
    const original = db.default.$transaction;
    db.default.$transaction = async (run, options) => { assert.equal(options.isolationLevel, 'Serializable'); return run(tx); };
    t.after(() => { db.default.$transaction = original; });
    return { writes, audits: () => audits };
}
test('English supersede preview performs no writes', async t => {
    const f = fixture(t); const r = await releaseLinkedIn1128Rev3(args);
    assert.equal(r.mode, 'preview'); assert.equal(r.publication_authorized, false); assert.deepEqual(f.writes, []); assert.equal(f.audits(), 0);
});
test('English replacement preserves records, creates one new WI and replays its audit', async t => {
    const f = fixture(t); const first = await releaseLinkedIn1128Rev3({ ...args, apply: true });
    const replay = await releaseLinkedIn1128Rev3({ ...args, apply: true });
    assert.equal(first.browser_work_item_id, 2001); assert.equal(replay.browser_work_item_id, 2001); assert.equal(replay.replayed, true);
    assert.equal(first.identity_binding.content_revision, 3); assert.equal(f.audits(), 1);
    assert.deepEqual(f.writes, ['old-attempt', 'old-work', 'task-projection', 'new-work']);
});
test('replacement CAS failure never creates new WI or successful audit', async t => {
    const f = fixture(t, true); await assert.rejects(releaseLinkedIn1128Rev3({ ...args, apply: true }), /CAS_CONFLICT/);
    assert.equal(f.writes.includes('new-work'), false); assert.equal(f.audits(), 0);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
