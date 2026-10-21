const test = require('node:test'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { recoveryFixture } = require('./x-native-pairing-recovery.fixture.cjs');
const sha = s => createHash('sha256').update(s).digest('hex');
test('more than three expired requests never becomes a lifetime ban; prior nonce cannot enroll', async t => {
    const s = await recoveryFixture(t), nonces = new Set([s.first.challenge.nonce]);
    for (let i = 1; i <= 6; i++) {
        s.time(i * 300001);
        const next = await s.ordinary({ idempotencyKey: `window-${i}` });
        assert.equal(next.mode, 'pairing_challenge'); assert.equal(next.publication_authorized, false);
        assert.equal(nonces.has(next.challenge.nonce), false); nonces.add(next.challenge.nonce);
    }
    await assert.rejects(s.enroll(), /PAIRING_SUPERSEDED/);
    assert.equal(s.f.state.attempts.length, 0);
});
test('legacy three-issue root and expired unverified recovery successor can reconnect with the same installation', async t => {
    const s = await recoveryFixture(t);
    const rootRow = s.f.state.nativeSettings.find(r => r.key.startsWith('x_native:pairing:v1:'));
    const root = JSON.parse(rootRow.value);
    delete root.issueVersion; rootRow.value = JSON.stringify(root);
    s.f.state.nativeSettings = s.f.state.nativeSettings.filter(r => !r.key.startsWith('x_native:pairing-active:'));
    const legacy = { ...root, challenge: { ...root.challenge, nonce: 'e'.repeat(64) }, verifiedSha256: null, recoveryRoot: sha(root.challenge.nonce) };
    delete legacy.issueVersion;
    s.f.state.nativeSettings.push({ id: 999, project_id: s.setup.projectId, key: 'x_native:pairing:v1:' + sha(legacy.challenge.nonce), value: JSON.stringify(legacy) });
    const issued = s.f.state.events.find(e => e.command === 'x_native_issue_pairing');
    s.f.state.events.push({ ...issued, id: 991 }, { ...issued, id: 992 });
    s.f.state.events.push({ ...issued, id: 993, command: 'x_native_recover_pairing', idempotency_key: sha(root.challenge.nonce), after_state: {
        challenge_sha256: sha(JSON.stringify(legacy.challenge)), snapshot_sha256: sha(JSON.stringify(root.context.snapshot)),
        successor_nonce_sha256: sha(legacy.challenge.nonce), publication_authorized: false } });
    const beforeRoot = rootRow.value; s.time(600001); s.manifestOnly();
    const next = await s.ordinary({ idempotencyKey: 'after-exhausted-legacy' });
    assert.equal(next.challenge.installationId, s.setup.installationId);
    assert.equal(next.challenge.manifest, s.setup.snapshot.manifestChecksum);
    assert.equal(rootRow.value, beforeRoot);
    await s.verify(next.challenge);
    assert.equal((await s.enroll(next.challenge)).mode, 'registered');
    assert.equal(s.f.state.attempts.length, 0);
});
test('same idempotency request returns one active nonce without renewing TTL; another request gets precise backoff', async t => {
    const s = await recoveryFixture(t), before = structuredClone(s.f.state);
    const repeated = await s.ordinary();
    assert.equal(repeated.challenge.nonce, s.first.challenge.nonce);
    assert.equal(repeated.challenge.expiresAt, s.first.challenge.expiresAt);
    assert.deepEqual(s.f.state, before);
    await assert.rejects(s.ordinary({ idempotencyKey: 'second-active' }), error => {
        assert.match(error.message, /PAIRING_ACTIVE/); assert.equal(error.retryAfterSeconds, 300); return true;
    });
});
test('sliding window throttling expires and returns retryAfter rather than permanent denial', async t => {
    const s = await recoveryFixture(t); s.time(300001);
    const issued = s.f.state.events.find(e => e.command === 'x_native_issue_pairing');
    for (let i = 0; i < 10; i++) s.f.state.events.push({ ...issued, id: 1000+i, created_at: new Date(s.start + 1) });
    await assert.rejects(s.ordinary({ idempotencyKey: 'rate-request' }), error => {
        assert.match(error.message, /PAIRING_THROTTLED/); assert.equal(error.retryAfterSeconds, 600); return true;
    });
    s.time(900002);
    assert.equal((await s.ordinary({ idempotencyKey: 'after-rate-window' })).mode, 'pairing_challenge');
});
test('registered, revoked or foreign bindings cannot obtain another pairing', async t => {
    for (const mode of ['registered', 'revoked', 'foreign']) await t.test(mode, async sub => {
        const s = await recoveryFixture(sub);
        if (mode === 'registered') await s.enroll();
        if (mode === 'revoked') s.f.state.events.push({ project_id: s.setup.projectId, command: 'x_native_revoke_installation',
            idempotency_key: `${s.setup.snapshot.channelId}:${s.setup.installationId}` });
        s.time(300001); const before = structuredClone(s.f.state);
        await assert.rejects(s.ordinary({ idempotencyKey: 'no-second-registration', ...(mode === 'foreign' ? { actorId: 'user:3' } : {}) }),
            /INSTALLATION|BINDING|OWNER/);
        assert.deepEqual(s.f.state, before);
    });
});
test('expired request replay cannot renew time and a failed audit rolls back supersession', async t => {
    const s = await recoveryFixture(t); s.time(300001);
    let before = structuredClone(s.f.state);
    await assert.rejects(s.ordinary(), /PAIRING_EXPIRED/); assert.deepEqual(s.f.state, before);
    s.f.state.failAudit = true; before = structuredClone(s.f.state);
    await assert.rejects(s.ordinary({ idempotencyKey: 'rollback-window' }), /audit unavailable/);
    assert.deepEqual(s.f.state, before);
});
test('fresh issue requires a current snapshot, and same-key request rebinding is rejected', async t => {
    const s = await recoveryFixture(t), before = structuredClone(s.f.state);
    await assert.rejects(s.ordinary({ approvalReference: 'Different synthetic request authority' }), /IDEMPOTENCY_CONFLICT/);
    s.f.state.manifest = 'sha256:' + 'f'.repeat(64);
    await assert.rejects(s.ordinary({ idempotencyKey: 'stale-window' }), /STALE_MANIFEST/);
    s.f.state.manifest = before.manifest; assert.deepEqual(s.f.state, before);
});
