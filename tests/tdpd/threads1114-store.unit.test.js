const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const guard = require('../../dist/services/threads1114_store_guard');
const fact = require('../../dist/services/publication_fact.service').default;
const store = require('../../dist/services/threads1114_store');
const p = require('../../dist/services/threads1114_contract').THREADS1114;
const args = { projectId: 10, taskId: 1114, actorId: 'user:2', expectedManifestChecksum: p.manifest,
    approvalReference: 'synthetic exact owner approval', idempotencyKey: 'synthetic-1114-key', releaseIdempotencyKey: 'synthetic-1114-key' };

function transaction(t, tx) {
    t.mock.method(guard, 'ownerOnly', async () => 2);
    const original = db.default.$transaction;
    db.default.$transaction = async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable');
        return callback(tx);
    };
    t.after(() => { db.default.$transaction = original; });
}
test('1114 claim CAS failure creates neither attempt nor claim event', async t => {
    const calls = [];
    transaction(t, { contentItem: { updateMany: async () => ({ count: 0 }) },
        deliveryAttempt: { create: async () => calls.push('attempt') },
        workflowEvent: { create: async () => calls.push('event') } });
    t.mock.method(guard, 'checked1114', async () => ({ task: { updated_at: new Date(), draft_text: 'synthetic' } }));
    await assert.rejects(store.claim1114(args), /CAS_CONFLICT/);
    assert.deepEqual(calls, []);
});
test('1114 claim persists pending/manual-confirmation fence before returning the body', async t => {
    const calls = [];
    transaction(t, { contentItem: { updateMany: async () => { calls.push('cas'); return { count: 1 }; } },
        deliveryAttempt: { create: async ({ data }) => {
            assert.equal(data.requires_manual_confirmation, true);
            assert.equal(data.status, 'pending'); assert.equal(data.idempotency_key, args.idempotencyKey);
            calls.push('attempt'); return { id: 123 };
        } }, workflowEvent: { create: async () => calls.push('audit') } });
    t.mock.method(guard, 'checked1114', async () => ({ task: { updated_at: new Date(), draft_text: 'synthetic' } }));
    assert.deepEqual(await store.claim1114(args), { id: 123, body: 'synthetic' });
    assert.deepEqual(calls, ['cas', 'attempt', 'audit']);
});
test('1114 confirmation guards and updates attempt inside canonical fact transaction', async t => {
    const calls = [];
    t.mock.method(guard, 'checked1114', async (_tx, request, released, id) => {
        assert.equal(request, args); assert.equal(released, true); assert.equal(id, 123); calls.push('guard');
    });
    t.mock.method(fact, 'record', async input => {
        assert.equal(input.providerObjectId, '200');
        assert.equal(input.confirmationMode, 'automatic');
        assert.equal(typeof input.beforeWrite, 'function');
        await input.beforeWrite({ deliveryAttempt: { updateMany: async ({ data }) => {
            assert.equal(data.status, 'delivered'); assert.equal(data.requires_manual_confirmation, false);
            calls.push('attempt'); return { count: 1 };
        } }, workflowEvent: { create: async () => calls.push('audit') } });
        calls.push('fact'); return {};
    });
    await store.confirm1114(args, 123, { id: '200', url: 'https://www.threads.net/@innokentybo/post/SHORT',
        publishedAt: '2026-10-15T07:00:00Z' });
    assert.deepEqual(calls, ['guard', 'attempt', 'audit', 'fact']);
});
test('1114 conflicting replay rejects before returning another request proof', async t => {
    t.mock.method(guard, 'ownerManifest', async () => undefined);
    transaction(t, { workflowEvent: { findFirst: async () => ({ before_state: { request_hash: 'another' }, after_state: {} }) } });
    await assert.rejects(store.replay1114(args, 'send'), /IDEMPOTENCY_CONFLICT/);
});
test('1114 pending replay is reconcile-only with no new attempt', async t => {
    t.mock.method(guard, 'ownerManifest', async () => undefined);
    transaction(t, { workflowEvent: { findFirst: async () => null },
        deliveryAttempt: { findFirst: async () => ({ id: 123, status: 'pending' }) },
        publicationFact: { findFirst: async () => null } });
    assert.deepEqual(await store.replay1114(args, 'send'), { mode: 'verification_required', retry_allowed: false, task_id: 1114 });
});
test('1114 recorded replay remains available after manifest drift without new writes', async t => {
    t.mock.method(guard, 'ownerManifest', async () => { throw new Error('[STALE_MANIFEST]'); });
    const proof = { publication_authorized: true };
    transaction(t, { projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => ({ before_state: { request_hash: guard.requestHash(args, 'release') }, after_state: proof }) } });
    assert.deepEqual(await store.replay1114(args, 'release'), proof);
});
test('1114 identical release rechecks its durable proof inside the CAS transaction', async t => {
    t.mock.method(guard, 'checked1114', async () => { throw new Error('must replay before package CAS'); });
    t.mock.method(guard, 'ownerManifest', async () => undefined);
    const proof = { publication_authorized: true, actor_id: args.actorId, release_idempotency_key: args.idempotencyKey };
    transaction(t, { projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async () => ({ before_state: { request_hash: guard.requestHash(args, 'release') }, after_state: proof }) } });
    assert.deepEqual(await store.release1114(args), proof);
});
test('1114 release proof cannot transfer across owners or release keys', () => {
    const release = { before_state: { approval_reference: args.approvalReference }, after_state: {
        publication_authorized: true, body_sha256: p.bodySha256, actor_id: args.actorId,
        release_idempotency_key: args.releaseIdempotencyKey, manifest_checksum: p.manifest,
        channel_id: 138, accepted_revision: 1, threads_user_id: p.userId, schedule_at: p.schedule,
        publish_at: p.schedule, decision_id: 309, selected_asset_id: null } };
    assert.equal(guard.validRelease1114(args, release), true);
    assert.equal(guard.validRelease1114({ ...args, actorId: 'user:3' }, release), false);
    assert.equal(guard.validRelease1114({ ...args, releaseIdempotencyKey: 'other-release' }, release), false);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
