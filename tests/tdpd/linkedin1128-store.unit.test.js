const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const guard = require('../../dist/services/linkedin1128_submission_guard');
const service = require('../../dist/services/linkedin1128_submission.service');
const fact = require('../../dist/services/publication_fact.service').default;
const p = require('../../dist/services/linkedin1128_identity.service').LINKEDIN1128;
const a = { projectId: 7, taskId: 1128, channelId: 6, workItemId: 1924, actorId: 'user:2',
    leaseToken: 'synthetic', approvalReference: 'synthetic existing owner approval', idempotencyKey: 'synthetic-1128',
    expectedManifestChecksum: p.manifest, contentRevision: 1, textSha256: p.body,
    selectedAssetId: null, imageSha256: null, observedCompanyId: '97416172',
    authorEvidenceSha256: 'a'.repeat(64), duplicateCheckReference: 'synthetic duplicate readback' };
function transaction(t, tx) {
    const original = db.default.$transaction;
    db.default.$transaction = async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable'); return callback(tx);
    };
    t.after(() => { db.default.$transaction = original; });
}
test('1128 start never creates another WI and CAS failure creates no attempt', async t => {
    const calls = [];
    t.mock.method(guard, 'check1128', async () => ({ task: { status: 'browser_required', updated_at: new Date() } }));
    transaction(t, { deliveryAttempt: { findFirst: async () => null, create: async () => calls.push('attempt') },
        contentItem: { updateMany: async () => ({ count: 0 }) } });
    await assert.rejects(service.startLinkedIn1128(a), /CAS_CONFLICT/);
    assert.deepEqual(calls, []);
});
test('1128 prior attempt is reconcile-only even with a different key', async t => {
    t.mock.method(guard, 'check1128', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findFirst: async () => ({ id: 123, idempotency_key: 'original' }) } });
    assert.deepEqual(await service.startLinkedIn1128(a), { mode: 'verification_required', attempt_id: 123, retry_allowed: false });
});
test('1128 atomic confirmation rechecks lease inside canonical fact before mutating attempt', async t => {
    t.mock.method(guard, 'check1128Owner', async () => undefined);
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(guard, 'check1128', async () => { throw new Error('[LINKEDIN1128_ACTIVE_PACKAGE_LEASE_REQUIRED]'); });
    let writes = 0;
    t.mock.method(fact, 'record', async input => {
        assert.equal(input.confirmationMode, 'reconciled');
        await input.beforeWrite({ deliveryAttempt: { updateMany: async () => { writes += 1; } } });
        writes += 1;
    });
    await assert.rejects(service.confirmLinkedIn1128({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) }), /ACTIVE_PACKAGE_LEASE_REQUIRED/);
    assert.equal(writes, 0);
});
test('1128 pre-submit rejects changed author evidence under an existing phase key', async t => {
    t.mock.method(guard, 'check1128', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findMany: async () => [{ id: 123, status: 'pending', channel_id: 6, idempotency_key: a.idempotencyKey }] },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) } } } });
    await assert.rejects(service.preSubmitLinkedIn1128({ ...a, attemptId: 123, authorEvidenceSha256: 'c'.repeat(64) }), /IDEMPOTENCY_CONFLICT/);
});
test('1128 valid confirmation updates attempt and audit inside the canonical fact hook', async t => {
    const calls = [];
    t.mock.method(guard, 'check1128Owner', async () => undefined);
    t.mock.method(guard, 'check1128', async () => { calls.push('guard'); return { task: { status: 'publishing' } }; });
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(fact, 'record', async input => {
        await input.beforeWrite({ deliveryAttempt: {
            findMany: async () => [{ id: 123, status: 'pending', channel_id: 6, idempotency_key: a.idempotencyKey }],
            updateMany: async ({ data }) => { assert.equal(data.status, 'delivered'); calls.push('attempt'); return { count: 1 }; }
        }, workflowEvent: {
            findFirst: async ({ where }) => where.command.startsWith('ba_start_')
                ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
                : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { attempt_id: 123 } },
            create: async () => calls.push('audit')
        } });
        calls.push('fact'); return {};
    });
    const result = await service.confirmLinkedIn1128({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) });
    assert.equal(result.mode, 'published'); assert.deepEqual(calls, ['guard', 'attempt', 'audit', 'fact']);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
