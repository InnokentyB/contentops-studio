const test = require('node:test'), assert = require('node:assert/strict');
const { recoveryFixture } = require('./x-native-pairing-recovery.fixture.cjs');
test('verified no-send evidence enrolls after human acceptance delay without renewing the challenge', async t => {
    const s = await recoveryFixture(t); s.time(300001);
    const before = structuredClone(s.f.state);
    assert.equal((await s.enroll(undefined, { apply: false })).mode, 'preview');
    assert.deepEqual(s.f.state, before);
    assert.equal((await s.enroll()).mode, 'registered');
    assert.equal(s.f.state.attempts.length, 0);
});
test('preview and apply reject expired enrollment, missing audit, future audit and consumed evidence without writes', async t => {
    for (const kind of ['cutoff', 'missing', 'future', 'consumed']) await t.test(kind, async sub => {
        const s = await recoveryFixture(sub); s.time(400000);
        const row = s.f.state.nativeSettings.find(r => r.key.startsWith('x_native:pairing:'));
        if (kind === 'cutoff') s.time(86400000);
        if (kind === 'missing') s.f.state.events = s.f.state.events.filter(e => e.command !== 'x_native_pairing_verified');
        if (kind === 'future') s.f.state.events.find(e => e.command === 'x_native_pairing_verified').created_at = new Date(s.start + 400001);
        if (kind === 'consumed') { const v = JSON.parse(row.value); v.consumed = true; row.value = JSON.stringify(v); }
        const before = structuredClone(s.f.state);
        for (const apply of [false, true]) await assert.rejects(s.enroll(undefined, { apply }), /PAIRING_(ENROLLMENT_EXPIRED|INVALID)/);
        assert.deepEqual(s.f.state, before);
    });
});
test('recovery requires durable exact grant; reference alone or changed caller binding cannot apply', async t => {
    const s = await recoveryFixture(t); s.time(300001); s.manifestOnly();
    await assert.rejects(s.recovery('apply', 'f'.repeat(64)), /RECOVERY_GRANT_REQUIRED/);
    const grant = await s.recovery('authorize'), before = structuredClone(s.f.state);
    await assert.rejects(s.recovery('apply', 'f'.repeat(64)), /RECOVERY_GRANT_INVALID/);
    await assert.rejects(s.recovery('apply', grant.grantId, { actorId: 'user:3' }), /RECOVERY_BINDING_MISMATCH/);
    await assert.rejects(s.recovery('apply', grant.grantId, { bundleSha256: '9'.repeat(64) }), /RECOVERY_BINDING_MISMATCH/);
    assert.deepEqual(s.f.state, before);
});
test('only manifest may change; every other snapshot field is immutable during recovery', async t => {
    for (const delta of [{ scheduleAt: '2030-01-01T00:00:00.000Z' }, { contentRevision: 99 }, { bodySha256: '9'.repeat(64) },
        { channelId: 999 }, { contentLanguage: 'ru' }, { decisionVersion: 99 }]) await t.test(Object.keys(delta)[0], async sub => {
        const s = await recoveryFixture(sub); s.time(300001); s.manifestOnly();
        const before = structuredClone(s.f.state);
        await assert.rejects(s.recovery('preview', undefined, { snapshot: { ...s.setup.snapshot, ...delta } }), /RECOVERY_BINDING_MISMATCH|BROWSER_SNAPSHOT_MISMATCH/);
        assert.deepEqual(s.f.state, before);
    });
});
test('grant expiry boundary and sticky revocation reject without new issuance', async t => {
    for (const mode of ['expired', 'revoked']) await t.test(mode, async sub => {
        const s = await recoveryFixture(sub); s.time(300001);
        const grant = await s.recovery('authorize');
        if (mode === 'expired') s.time(1200001);
        else assert.equal((await s.recovery('revoke', grant.grantId)).mode, 'pairing_recovery_revoked');
        const before = structuredClone(s.f.state);
        await assert.rejects(s.recovery('apply', grant.grantId), /RECOVERY_GRANT_(INVALID|EXPIRED)/);
        assert.deepEqual(s.f.state, before);
    });
});
test('supersession leaves predecessor bytes intact and blocks grant replay or second root recovery globally', async t => {
    const s = await recoveryFixture(t); const second = await s.ordinary(); await s.verify(second.challenge); s.time(300001);
    const predecessor = structuredClone(s.f.state.nativeSettings.find(r => r.key.startsWith('x_native:pairing:')));
    const grant = await s.recovery('authorize'); await s.recovery('apply', grant.grantId);
    assert.deepEqual(s.f.state.nativeSettings.find(r => r.id === predecessor.id), predecessor);
    await assert.rejects(s.enroll(), /PAIRING_SUPERSEDED/);
    await assert.rejects(s.recovery('apply', grant.grantId), /PAIRING_SUPERSEDED|RECOVERY_LIMIT/);
    await assert.rejects(s.pairing.issueNativePairing({ ...s.setup, recovery: { phase: 'authorize', predecessorNonce: second.challenge.nonce,
        approvalReference: 'Another explicit synthetic Owner recovery approval' } }, s.f), /RECOVERY_LIMIT/);
});
test('failed immutable audit rolls back grant consumption and successor issuance', async t => {
    const s = await recoveryFixture(t); s.time(300001); const grant = await s.recovery('authorize');
    s.f.state.failAudit = true; const before = structuredClone(s.f.state);
    await assert.rejects(s.recovery('apply', grant.grantId), /audit unavailable/);
    assert.deepEqual(s.f.state, before);
});
test('challenge verification never gains the longer enrollment window', async t => {
    const s = await recoveryFixture(t); s.time(300000);
    const before = structuredClone(s.f.state);
    await assert.rejects(s.verify(s.first.challenge), /PAIRING_EXPIRED/);
    assert.deepEqual(s.f.state, before);
});
test('root recovery rejects missing verification, future clock, twenty-four-hour cutoff and prior delivery', async t => {
    for (const mode of ['unverified', 'clock', 'cutoff', 'attempt', 'revocation']) await t.test(mode, async sub => {
        const s = await recoveryFixture(sub); s.time(300001);
        if (mode === 'unverified') s.f.state.events = s.f.state.events.filter(e => e.command !== 'x_native_pairing_verified');
        if (mode === 'clock') s.time(-1);
        if (mode === 'cutoff') s.time(86400000);
        if (mode === 'attempt') s.f.state.attempts.push({ project_id: s.setup.projectId, content_item_id: s.setup.taskId });
        if (mode === 'revocation') s.f.state.events.push({ project_id: s.setup.projectId,
            command: 'x_native_revoke_installation', idempotency_key: `${s.setup.snapshot.channelId}:${s.setup.installationId}` });
        const before = structuredClone(s.f.state);
        await assert.rejects(s.recovery('preview'), /PAIRING_INVALID|ENROLLMENT_EXPIRED|RECONCILIATION_REQUIRED|INSTALLATION_EXISTS/);
        assert.deepEqual(s.f.state, before);
    });
});
test('one audited recovery binds the current manifest after three ordinary issues; requires a fresh signed proof', async t => {
    const s = await recoveryFixture(t); await s.ordinary(); await s.ordinary(); s.time(300001); s.manifestOnly();
    await assert.rejects(s.ordinary(), /PAIRING_LIMIT/);
    const before = structuredClone(s.f.state);
    const preauthorization = await s.recovery('preview');
    assert.equal(preauthorization.mode, 'pairing_recovery_authorization_preview');
    assert.equal(preauthorization.apply_ready, false);
    assert.equal(preauthorization.code, 'X_NATIVE_RECOVERY_GRANT_REQUIRED');
    assert.deepEqual(s.f.state, before);
    const grant = await s.recovery('authorize');
    assert.equal(grant.mode, 'pairing_recovery_authorized');
    const authorizedState = structuredClone(s.f.state);
    const preview = await s.recovery('preview', grant.grantId);
    assert.equal(preview.mode, 'pairing_recovery_preview');
    assert.equal(preview.apply_ready, true);
    assert.deepEqual(s.f.state, authorizedState);
    await assert.rejects(s.recovery('preview', 'f'.repeat(64)), /RECOVERY_GRANT_INVALID/);
    const recovered = await s.recovery('apply', grant.grantId);
    assert.equal(recovered.challenge.manifest, s.setup.snapshot.manifestChecksum);
    assert.notEqual(recovered.challenge.nonce, s.first.challenge.nonce);
    await assert.rejects(s.enroll(recovered.challenge), /PAIRING_INVALID/);
    await s.verify(recovered.challenge);
    assert.equal((await s.enroll(recovered.challenge)).mode, 'registered');
    assert.equal(s.f.state.events.filter(e => e.command === 'x_native_issue_pairing').length, 3);
    assert.equal(s.f.state.events.filter(e => e.command === 'x_native_recover_pairing').length, 1);
    assert.equal(s.f.state.attempts.length, 0);
});
