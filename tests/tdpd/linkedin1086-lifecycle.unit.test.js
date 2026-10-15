const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const guard = require('../../dist/services/linkedin1086_guard');
const service = require('../../dist/services/linkedin1086_lifecycle');
const fact = require('../../dist/services/publication_fact.service').default;
const p = require('../../dist/services/linkedin1086_contract').LINKEDIN1086;
const a = { projectId: 7, taskId: 1086, channelId: 5, workItemId: 2001, actorId: 'user:2',
    releaseIdempotencyKey: 'synthetic-rev3-release', leaseToken: 'synthetic', approvalReference: 'synthetic existing owner approval', idempotencyKey: 'synthetic-1128',
    expectedManifestChecksum: p.manifest, contentRevision: 1, textSha256: p.body,
    selectedAssetId: null, imageSha256: null, observedProfileUrl: p.profile,
    actionTimeConfirmationReference: 'synthetic owner confirmation at Post',
    observedEditorText: require('../fixtures/linkedin1086-body'),
    observedPostText: require('../fixtures/linkedin1086-body'), observedAuthorProfileUrl: p.profile, observedPublishedAt: '2026-10-15T10:01:00Z',
    authorEvidenceSha256: 'a'.repeat(64), duplicateCheckReference: 'synthetic duplicate readback' };
function transaction(t, tx) {
    const original = db.default.$transaction;
    db.default.$transaction = async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable'); return callback(tx);
    };
    t.after(() => { db.default.$transaction = original; });
}
test('1086 start never creates another WI and CAS failure creates no attempt', async t => {
    const calls = [];
    t.mock.method(guard, 'check1086', async () => ({ task: { status: 'browser_required', updated_at: new Date() } }));
    transaction(t, { deliveryAttempt: { findFirst: async () => null, create: async () => calls.push('attempt') },
        contentItem: { updateMany: async () => ({ count: 0 }) } });
    await assert.rejects(service.startLinkedIn1086(a), /CAS_CONFLICT/);
    assert.deepEqual(calls, []);
});
test('1086 prior attempt is reconcile-only even with a different key', async t => {
    t.mock.method(guard, 'check1086', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findFirst: async () => ({ id: 123, idempotency_key: 'original' }) } });
    assert.deepEqual(await service.startLinkedIn1086(a), { mode: 'verification_required', attempt_id: 123, retry_allowed: false });
});
test('1086 atomic confirmation rechecks lease inside canonical fact before mutating attempt', async t => {
    t.mock.method(guard, 'check1086Owner', async () => undefined);
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(guard, 'check1086', async () => { throw new Error('[LINKEDIN1086_LEASE_REQUIRED]'); });
    let writes = 0;
    t.mock.method(fact, 'record', async input => {
        assert.equal(input.confirmationMode, 'manual');
        await input.beforeWrite({ deliveryAttempt: { updateMany: async () => { writes += 1; } } });
        writes += 1;
    });
    await assert.rejects(service.confirmLinkedIn1086({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-15T10:01:00Z', evidenceSha256: 'b'.repeat(64) }), /LEASE_REQUIRED/);
    assert.equal(writes, 0);
});
test('1086 pre-submit rejects changed author evidence under an existing phase key', async t => {
    t.mock.method(guard, 'check1086', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findMany: async () => [{ id: 123, status: 'pending', channel_id: 5, idempotency_key: a.idempotencyKey }] },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) } } } });
    await assert.rejects(service.preSubmitLinkedIn1086({ ...a, attemptId: 123, authorEvidenceSha256: 'c'.repeat(64) }), /IDEMPOTENCY_CONFLICT/);
});
test('1086 uncertainty forbids another pre-submit permission', async t => {
    t.mock.method(guard, 'check1086', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findMany: async () => [{ id: 123, status: 'pending', channel_id: 5,
        idempotency_key: a.idempotencyKey, error_message: 'LINKEDIN1086_UNCERTAIN_RECONCILE_ONLY' }] },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { submission_permitted: true } } } });
    await assert.rejects(service.preSubmitLinkedIn1086({ ...a, attemptId: 123 }), /RECONCILE_ONLY/);
});
test('1086 replay of an issued pre-submit check never grants a second Submit', async t => {
    t.mock.method(guard, 'check1086', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findMany: async () => [{ id: 123, status: 'pending', channel_id: 5, idempotency_key: a.idempotencyKey }] },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { submission_permitted: true } } } });
    const result = await service.preSubmitLinkedIn1086({ ...a, attemptId: 123 });
    assert.equal(result.submission_permitted, false); assert.equal(result.retry_allowed, false);
});
test('1086 valid confirmation updates attempt and audit inside the canonical fact hook', async t => {
    const calls = [];
    t.mock.method(guard, 'check1086Owner', async () => undefined);
    t.mock.method(guard, 'check1086', async () => { calls.push('guard'); return { task: { status: 'publishing' } }; });
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(fact, 'record', async input => {
        await input.beforeWrite({ deliveryAttempt: {
            findMany: async () => [{ id: 123, status: 'pending', channel_id: 5, idempotency_key: a.idempotencyKey, created_at: new Date('2026-10-15T10:00:30Z') }],
            updateMany: async ({ data }) => { assert.equal(data.status, 'delivered'); calls.push('attempt'); return { count: 1 }; }
        }, workflowEvent: {
            findFirst: async ({ where }) => where.command.startsWith('ba_start_')
                ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
                : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { attempt_id: 123 }, created_at: new Date('2026-10-15T10:00:45Z') },
            create: async () => calls.push('audit')
        } });
        calls.push('fact'); return {};
    });
    const result = await service.confirmLinkedIn1086({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-15T10:01:00Z', evidenceSha256: 'b'.repeat(64) });
    assert.equal(result.mode, 'published'); assert.deepEqual(calls, ['guard', 'attempt', 'audit', 'fact']);
});
test('1086 cannot attach an older publication to a newly started attempt', async t => {
    let writes = 0;
    t.mock.method(guard, 'check1086Owner', async () => undefined);
    t.mock.method(guard, 'check1086', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(fact, 'record', async input => {
        await input.beforeWrite({ deliveryAttempt: {
            findMany: async () => [{ id: 123, status: 'pending', channel_id: 5, idempotency_key: a.idempotencyKey, created_at: new Date('2026-10-15T11:00:00Z') }],
            updateMany: async () => { writes += 1; return { count: 1 }; }
        }, workflowEvent: {
            findFirst: async ({ where }) => where.command.startsWith('ba_start_')
                ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
                : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { attempt_id: 123 }, created_at: new Date('2026-10-15T11:00:30Z') },
            create: async () => undefined
        } });
        return {};
    });
    await assert.rejects(service.confirmLinkedIn1086({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-15T10:01:00Z', evidenceSha256: 'b'.repeat(64) }), /PUBLISHED_BEFORE_ATTEMPT/);
    assert.equal(writes, 0);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
test('r3 cannot confirm an unrelated native body or fabricated author/time', async () => {
    for (const patch of [{ observedPostText: 'not this accepted post' }, { observedAuthorProfileUrl: 'other' }, { observedPublishedAt: '2026-10-15T10:00:00Z' }]) {
        await assert.rejects(service.confirmLinkedIn1086({ ...a, attemptId: 123,
            publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
            publishedAt: '2026-10-15T10:01:00Z', evidenceSha256: 'b'.repeat(64), ...patch }), /PROVIDER_IDENTITY_INVALID/);
    }
});

