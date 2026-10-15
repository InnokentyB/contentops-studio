const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const guard = require('../../dist/services/linkedin1128_rev3_guard');
const p = require('../../dist/services/linkedin1128_rev3_contract').LINKEDIN1128R3;
const { leaseLinkedIn1128Rev3 } = require('../../dist/services/linkedin1128_rev3_lease');
const a = { projectId: 7, taskId: 1128, channelId: 6, workItemId: 2001, actorId: 'user:2',
    approvalReference: 'synthetic owner English correction', expectedManifestChecksum: p.manifest,
    contentRevision: 3, textSha256: p.body, selectedAssetId: null, imageSha256: null,
    idempotencyKey: 'synthetic-r3-lease', releaseIdempotencyKey: 'synthetic-r3-release',
    observedCompanyId: '97416172', authorEvidenceSha256: 'a'.repeat(64), duplicateCheckReference: 'synthetic native duplicate check' };
function fixture(t, renew, attempted = false) {
    let writes = 0; let prior = null;
    const work = { id: 2001, state: renew ? 'claimed' : 'available', lease_actor_id: renew ? 'user:2' : null,
        lease_token: renew ? 'synthetic-expired-fence' : null, lease_expires_at: renew ? new Date('2026-10-14T00:00:00Z') : null,
        updated_at: new Date() };
    t.mock.method(guard, 'rev3ReleasedWork', async () => ({ work }));
    const tx = { deliveryAttempt: { findFirst: async () => attempted ? { id: 39 } : null },
        workflowEvent: { findFirst: async ({ where }) => typeof where.command === 'string' ? prior : null,
            create: async ({ data }) => { prior = data; assert.ok(!JSON.stringify(data).includes(work.lease_token)); } },
        workItem: { updateMany: async ({ data }) => { writes += 1; Object.assign(work, data); return { count: 1 }; } } };
    const original = db.default.$transaction;
    db.default.$transaction = async (run, options) => { assert.equal(options.isolationLevel, 'Serializable'); return run(tx); };
    t.after(() => { db.default.$transaction = original; });
    return { work, writes: () => writes };
}
for (const renew of [false, true]) test(`r3 ${renew ? 'renewal' : 'claim'} preview and identical replay never extend twice`, async t => {
    const f = fixture(t, renew); const preview = await leaseLinkedIn1128Rev3(a, renew);
    assert.equal(preview.mode, 'preview'); assert.equal(f.writes(), 0); assert.equal(preview.lease_token, undefined);
    const apply = { ...a, apply: true, ...(renew ? { expectedExpiredLeaseAt: preview.expired_lease_at,
        expectedExpiredLeaseSha256: preview.expired_lease_sha256 } : {}) };
    const first = await leaseLinkedIn1128Rev3(apply, renew); const replay = await leaseLinkedIn1128Rev3(apply, renew);
    assert.equal(replay.lease_token, first.lease_token); assert.equal(replay.lease_expires_at, first.lease_expires_at);
    assert.equal(f.writes(), 1); assert.equal(replay.submission_permitted, false);
});
test('r3 existing attempt forbids renewal even after expiry', async t => {
    const f = fixture(t, true, true); await assert.rejects(leaseLinkedIn1128Rev3({ ...a, apply: true }, true), /RECONCILIATION_REQUIRED/);
    assert.equal(f.writes(), 0);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
