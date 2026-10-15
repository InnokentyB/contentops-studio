const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const guard = require('../../dist/services/linkedin1128_submission_guard');
const { renewLinkedIn1128Lease } = require('../../dist/services/linkedin1128_lease.service');
const p = require('../../dist/services/linkedin1128_identity.service').LINKEDIN1128;
const crypto = require('node:crypto');
const manifest = require('../../dist/services/agent_workspace_manifest.service');
const oldExpiry = '2026-10-14T12:46:00.000Z';
const oldToken = 'synthetic-old-lease';
const args = { projectId: 7, taskId: 1128, channelId: 6, workItemId: 1924, actorId: 'user:2',
    approvalReference: 'synthetic existing owner approval', idempotencyKey: 'synthetic-renew-1128',
    expectedManifestChecksum: p.manifest, contentRevision: 1, textSha256: p.body, selectedAssetId: null, imageSha256: null };
function fixture(t, options = {}) {
    let writes = 0; let events = 0; let prior = null;
    const work = { id: 1924, lease_actor_id: args.actorId, state: 'claimed', lease_token: oldToken,
        lease_expires_at: new Date(oldExpiry), updated_at: new Date(oldExpiry) };
    t.mock.method(guard, 'check1128RecoveryOwner', async () => {
        if (options.secretError) throw new Error('synthetic-private-token-value');
    });
    t.mock.method(guard, 'check1128RecoverySnapshot', async (_tx, a, phase) => {
        assert.equal(a.leaseToken, work.lease_token);
        assert.equal(work.lease_expires_at.getTime() <= Date.now(), phase === 'expired_recovery');
        return { task: { status: 'browser_required' }, work };
    });
    const tx = { deliveryAttempt: { findFirst: async () => options.attempt ? { id: 123 } : null },
        workItem: { findFirst: async () => work, updateMany: async ({ where, data }) => {
            assert.equal(where.id, 1924); assert.equal(where.state, 'claimed'); assert.equal(where.lease_actor_id, args.actorId);
            assert.equal(where.lease_token, oldToken); assert.equal(where.lease_expires_at.toISOString(), oldExpiry);
            assert.deepEqual(Object.keys(data).sort(), ['lease_expires_at', 'lease_token']);
            writes += 1; if (options.casFails) return { count: 0 };
            Object.assign(work, data); return { count: 1 };
        } }, workflowEvent: {
            findFirst: async ({ where }) => typeof where.command === 'string' ? prior : options.started ? { id: 1 } : null,
            create: async ({ data }) => { events += 1; prior = data;
                assert.equal(data.before_state.expired_lease_at, oldExpiry);
                assert.ok(!JSON.stringify(data).includes(oldToken));
                assert.equal(data.before_state.old_lease_sha256, guard.submissionHash(oldToken));
                assert.ok(!JSON.stringify(data).includes(work.lease_token));
            }
        } };
    const original = db.default.$transaction;
    db.default.$transaction = async (callback, isolation) => { assert.equal(isolation.isolationLevel, 'Serializable'); return callback(tx); };
    t.after(() => { db.default.$transaction = original; });
    return { work, counts: () => ({ writes, events }) };
}
test('1128 lease preview writes nothing and issues no new fence', async t => {
    const f = fixture(t); const result = await renewLinkedIn1128Lease(args);
    assert.equal(result.mode, 'preview'); assert.equal(result.expired_lease_at, oldExpiry); assert.equal(result.lease_token, undefined);
    assert.equal(result.expired_lease_sha256, guard.submissionHash(oldToken));
    assert.deepEqual(f.counts(), { writes: 0, events: 0 });
});
test('1128 renewal never surfaces unexpected secret-bearing diagnostics', async t => {
    fixture(t, { secretError: true });
    await assert.rejects(renewLinkedIn1128Lease(args), error => error instanceof Error
        && error.message.includes('LEASE_RECOVERY_FAILED') && !error.message.includes('synthetic-private'));
});
test('1128 renewal changes only the same WI fence/expiry and identical replay never extends it twice', async t => {
    const f = fixture(t); const apply = { ...args, apply: true, expectedExpiredLeaseAt: oldExpiry, expectedExpiredLeaseSha256: guard.submissionHash(oldToken) };
    const first = await renewLinkedIn1128Lease(apply); const replay = await renewLinkedIn1128Lease(apply);
    assert.equal(first.mode, 'renewed'); assert.notEqual(first.lease_token, oldToken);
    assert.equal(replay.lease_token, first.lease_token); assert.equal(replay.lease_expires_at, first.lease_expires_at);
    assert.equal(replay.replayed, true); assert.equal(first.publication_authority_changed, false);
    assert.deepEqual(f.counts(), { writes: 1, events: 1 });
});
for (const options of [{ attempt: true }, { started: true }]) {
    test('1128 any existing execution forbids renewal or resend authority', async t => {
        const f = fixture(t, options);
        await assert.rejects(renewLinkedIn1128Lease({ ...args, apply: true, expectedExpiredLeaseAt: oldExpiry, expectedExpiredLeaseSha256: guard.submissionHash(oldToken) }), /RECONCILIATION_REQUIRED/);
        assert.deepEqual(f.counts(), { writes: 0, events: 0 });
    });
}
test('1128 stale expiry and CAS conflicts cannot create a replacement history', async t => {
    const f = fixture(t, { casFails: true });
    await assert.rejects(renewLinkedIn1128Lease({ ...args, apply: true, expectedExpiredLeaseAt: '2026-10-13T12:46:00.000Z' }), /EXPECTED_EXPIRY_REQUIRED/);
    await assert.rejects(renewLinkedIn1128Lease({ ...args, apply: true, expectedExpiredLeaseAt: oldExpiry, expectedExpiredLeaseSha256: guard.submissionHash(oldToken) }), /CAS_CONFLICT/);
    assert.deepEqual(f.counts(), { writes: 1, events: 0 });
});
test('1128 actual guard refuses expired normal submission, active recovery and foreign actors', async t => {
    t.mock.method(manifest, 'loadAgentWorkspaceManifest', async () => ({ checksum: p.manifest, project: { slug: 'seturon' } }));
    // Isolate lease policy from the immutable production body; no provider/config fixture is needed.
    t.mock.method(crypto, 'createHash', () => ({ update() { return this; }, digest() { return p.body; } }));
    const work = { kind: 'browser_publish', assignee_role: 'browser_publisher', state: 'claimed',
        input_context_version: 1, lease_actor_id: args.actorId, lease_token: oldToken, lease_expires_at: new Date(oldExpiry) };
    const tx = { projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => ({ channel: { is_active: true, type: 'linkedin' },
            status: 'browser_required', publication_mode: 'browser_required', content_revision: 1, accepted_revision: 1,
            text_state: 'accepted', handoff_state: 'ready', visual_state: 'NO_VISUAL_NEEDED', visual_placement: 'feed',
            selected_asset_id: null, draft_text: 'synthetic accepted body', schedule_at: new Date(p.schedule) }) },
        workItem: { findFirst: async () => work }, artDirectionDecision: { findFirst: async () => ({ id: 305 }) } };
    const normal = { ...args, leaseToken: oldToken, observedCompanyId: '97416172',
        authorEvidenceSha256: 'a'.repeat(64), duplicateCheckReference: 'synthetic duplicate history' };
    await assert.rejects(guard.check1128(tx, normal), /ACTIVE_PACKAGE_LEASE_REQUIRED/);
    work.lease_expires_at = new Date(Date.now() + 60000);
    await assert.rejects(guard.check1128RecoverySnapshot(tx, { ...args, leaseToken: oldToken }, 'expired_recovery'), /EXPIRED_LEASE_REQUIRED/);
    work.lease_actor_id = 'user:3';
    await assert.rejects(guard.check1128RecoverySnapshot(tx, { ...args, leaseToken: oldToken }, 'expired_recovery'), /ACTIVE_PACKAGE_LEASE_REQUIRED/);
    tx.projectMember.findUnique = async () => ({ role: 'writer' });
    await assert.rejects(guard.check1128RecoveryOwner(tx, args), /OWNER_REQUIRED/);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
