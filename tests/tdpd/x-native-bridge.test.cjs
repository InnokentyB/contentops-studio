const test = require('node:test'), assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const base = process.env.SHARED_BROWSER_DIST || '/opt/planner/dist';
const registry = require(base + '/services/x_native_registry.js');
const pairing = require(base + '/services/x_native_pairing.js');
const control = require(base + '/services/x_native_control.js');
const advance = require(base + '/services/x_native_advance.js');
const execute = require(base + '/services/x_native_execution.js');
const nativeState = require(base + '/services/x_native_state.js');
const wire = require(base + '/services/x_native_receipt.js');
const release = require(base + '/services/browser_publication_release.js');
const lifecycle = require(base + '/services/browser_publication_execution.js');
const { xFixture } = require('./shared-x-native.fixture.cjs');
const { body } = require('./shared-browser.fixture.cjs');
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = keys.publicKey.export({ format: 'jwk' });
const publicKey = wire.nativePublicKeySchema.parse({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
const installationId = wire.nativeKeyFingerprint(publicKey), extensionId = 'a'.repeat(32), bundleSha256 = '8'.repeat(64);
const origin = `chrome-extension://${extensionId}`;
const signature = message => sign('sha256', Buffer.from(message), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const readProof = (challenge, operation) => {
    const value = { operation, projectId: challenge.projectId, channelId: challenge.channelId,
        installationId, bundleSha256, nonce: challenge.nonce, observedAt: new Date(Date.now()).toISOString() };
    return { ...value, signature: signature(wire.nativeReadMessage(value)) };
};
const receipt = (challenge, unknown = false) => {
    const value = { challenge, observation: unknown ? { kind: 'unknown', reason: 'native_gap', observedAt: new Date().toISOString() }
        : { kind: 'editor', observedAt: new Date().toISOString(), account: challenge.account, text: body,
            editorMode: 'new_post', attachments: 0, historyFrom: challenge.scheduleAt,
            historyThrough: new Date().toISOString(), historyComplete: true, scannedStatuses: 2, duplicateFound: false } };
    return { receipt: { ...value, signature: signature(wire.nativeMessage(value)) } };
};
async function ready(taskId = 4801, future = false) {
    const { f, args } = xFixture(taskId);
    if (future) {
        const date = new Date(Date.now() + 60000);
        args.snapshot.scheduleAt = date.toISOString(); args.snapshot.publishAt = date.toISOString();
        f.state.task.schedule_at = date; f.state.task.publish_at = date;
    }
    f.state.nativeSettings = [];
    const matches = (r, w) => Object.entries(w).every(([k, v]) => v && typeof v === 'object' ? ('startsWith' in v ? String(r[k]).startsWith(v.startsWith) : 'contains' in v ? String(r[k]).includes(v.contains) : false) : r[k] === v);
    f.db.projectSettings = {
        findFirst: async ({ where }) => f.state.nativeSettings.filter(row => matches(row, where)).sort((a,b)=>b.id-a.id)[0] || null,
        findUnique: async ({ where }) => f.state.nativeSettings.find(row => matches(row, where.project_id_key || where)) || null,
        create: async ({ data }) => {
            if (f.state.nativeSettings.some(row => row.project_id === data.project_id && row.key === data.key)) throw Error('synthetic unique conflict');
            const row = { id: 900 + f.state.nativeSettings.length, ...data }; f.state.nativeSettings.push(row); return row;
        },
        update: async ({ where, data }) => { const row = f.state.nativeSettings.find(row => matches(row, where)); Object.assign(row, data); return row; },
        updateMany: async ({ where, data }) => { const rows = f.state.nativeSettings.filter(row => matches(row, where));
            rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
        upsert: async ({ where, create, update }) => { const row = f.state.nativeSettings.find(row => matches(row, where.project_id_key));
            if (row) { Object.assign(row, update); return row; } return f.db.projectSettings.create({ data: create }); }
    };
    await release.repairBrowserPublicationMetadata({ ...args, idempotencyKey: 'metadata', apply: true }, f);
    return { f, args };
}
async function enrolled(taskId, future = false) {
    const { f, args } = await ready(taskId, future), setup = { ...args, publicKey, installationId, bundleSha256, extensionId };
    const issued = await pairing.issueNativePairing(setup, f);
    const pairingRead = await pairing.readNativePairing(readProof(issued.challenge, 'pair'), f, origin);
    assert.equal(pairingRead.accepted_text, body);
    const unsigned = { challenge: issued.challenge, account: args.snapshot.identity.accountRef,
        bodySha256: args.snapshot.bodySha256, observedAt: new Date().toISOString() };
    await pairing.verifyNativePairing({ ...unsigned, signature: signature(pairing.nativePairingMessage(unsigned)) }, f, origin);
    await registry.registerNativeInstallation({ ...setup, apply: true, pairingNonce: issued.challenge.nonce,
        uatReference: 'Explicit synthetic owner no-send UAT reference' }, f);
    await release.releaseBrowserPublication({ ...args, apply: true }, f);
    const workItemId = f.state.work[0].id;
    const lease = await lifecycle.claimBrowserPublication({ ...args, workItemId, idempotencyKey: 'claim' }, f);
    const context = { ...args, workItemId, leaseToken: lease.lease_token, idempotencyKey: 'send' };
    const stage = await control.issueNativeChallenge({ context, installationId, bundleSha256, phase: 'start', attemptId: null }, f);
    return { f, args, context, challenge: stage.challenge };
}
test('enrollment preview is no-write and unsigned/foreign-origin pairing cannot enroll', async () => {
    const { f, args } = await ready(), input = { ...args, publicKey, installationId, bundleSha256, extensionId,
        uatReference: 'Explicit synthetic owner no-send UAT reference' };
    const before = structuredClone(f.state);
    await assert.rejects(registry.registerNativeInstallation(input, f), /PAIRING_REQUIRED/);
    assert.deepEqual(f.state, before);
    await assert.rejects(registry.registerNativeInstallation({ ...input, apply: true }, f), /PAIRING_REQUIRED/);
    assert.deepEqual(f.state, before);
    const issued = await pairing.issueNativePairing({ ...args, publicKey, installationId, bundleSha256, extensionId }, f);
    await assert.rejects(pairing.readNativePairing(readProof(issued.challenge, 'pair'), f,
        `chrome-extension://${'b'.repeat(32)}`), /ORIGIN_DENIED/);
});
test('a signed pairing for one reviewed bundle cannot enroll another bundle or rewrite its proof', async () => {
    const { f, args } = await ready(), setup = { ...args, publicKey, installationId, bundleSha256, extensionId };
    const issued = await pairing.issueNativePairing(setup, f);
    const unsigned = { challenge: issued.challenge, account: args.snapshot.identity.accountRef,
        bodySha256: args.snapshot.bodySha256, observedAt: new Date().toISOString() };
    await pairing.verifyNativePairing({ ...unsigned, signature: signature(pairing.nativePairingMessage(unsigned)) }, f, origin);
    const before = structuredClone(f.state);
    await assert.rejects(registry.registerNativeInstallation({ ...setup, bundleSha256: '9'.repeat(64), apply: true,
        pairingNonce: issued.challenge.nonce, uatReference: 'Explicit synthetic owner no-send UAT reference' }, f), /BUNDLE_MISMATCH/);
    assert.deepEqual(f.state, before);
});
test('all signed delegate operations and owner issue reject a different bundle before state changes', async () => {
    const { f, context, challenge } = await enrolled(4810), before = structuredClone(f.state);
    assert.equal(challenge.bundleSha256, bundleSha256);
    await assert.rejects(control.issueNativeChallenge({ context, installationId, bundleSha256: '9'.repeat(64),
        phase: 'start', attemptId: null }, f), /BUNDLE_MISMATCH/);
    for (const operation of ['read', 'advance', 'reconcile', 'refresh', 'heartbeat']) {
        const wrong = { ...readProof(challenge, operation), bundleSha256: '9'.repeat(64) };
        wrong.signature = signature(wire.nativeReadMessage(wrong));
        const call = operation === 'read' ? () => control.readNativeChallenge(wrong, f, origin)
            : operation === 'refresh' ? () => control.refreshNativeStart(wrong, f, origin)
            : operation === 'heartbeat' ? () => control.heartbeatNativeExecution(wrong, f, origin)
            : () => advance.advanceNativeChallenge(wrong, operation === 'reconcile', f, origin);
        await assert.rejects(call(), /BUNDLE_MISMATCH/);
    }
    const wrongReceipt = receipt({ ...challenge, bundleSha256: '9'.repeat(64) });
    await assert.rejects(execute.executeNativeReceipt(wrongReceipt, f, origin), /BUNDLE_MISMATCH/);
    await assert.rejects(f.db.$transaction(tx => nativeState.consumeNativeReceipt(tx, wrongReceipt.receipt,
        context, 'start', f, origin)), /BUNDLE_MISMATCH/);
    assert.deepEqual(f.state, before);
});
test('enrolled build digest is immutable and legacy missing-digest enrollment cannot execute', async () => {
    const { f, args, challenge } = await enrolled(4811), before = structuredClone(f.state);
    await assert.rejects(registry.registerNativeInstallation({ ...args, publicKey, installationId, extensionId,
        bundleSha256: '9'.repeat(64), apply: true, uatReference: 'Explicit synthetic owner no-send UAT reference' }, f), /REBIND_FORBIDDEN/);
    assert.deepEqual(f.state, before);
    const row = f.state.nativeSettings.find(item => item.key.includes('installation'));
    const legacy = JSON.parse(row.value); delete legacy.bundleSha256; row.value = JSON.stringify(legacy);
    await assert.rejects(execute.executeNativeReceipt(receipt(challenge), f, origin));
    assert.equal(f.state.attempts.length, 0);
});
test('signed start consumes one nonce with one durable attempt; delegate wire never contains lease', async () => {
    const { f, context, challenge } = await enrolled();
    const read = await control.readNativeChallenge(readProof(challenge, 'read'), f, origin);
    assert.ok(!JSON.stringify(read).includes(context.leaseToken));
    assert.equal(read.context.leaseToken, undefined);
    const started = await execute.executeNativeReceipt(receipt(challenge), f, origin);
    assert.equal(started.submission_permitted, false); assert.equal(f.state.attempts.length, 1);
    const consumed = f.state.events.filter(e => e.command === 'x_native_consume_receipt'); assert.equal(consumed.length, 1);
    assert.equal((await execute.executeNativeReceipt(receipt(challenge), f, origin)).submission_permitted, false);
    assert.equal(f.state.attempts.length, 1); assert.equal(f.state.events.filter(e => e.command === 'x_native_consume_receipt').length, 1);
    const permitStage = await advance.advanceNativeChallenge(readProof(challenge, 'advance'), false, f, origin);
    assert.ok(!JSON.stringify(permitStage).includes(context.leaseToken));
    assert.equal(permitStage.challenge.phase, 'permit');
    const permit = await execute.executeNativeReceipt(receipt(permitStage.challenge), f, origin);
    assert.equal(permit.submission_permitted, true);
    assert.ok(Date.parse(permit.expires_at) - Date.now() <= 15000);
});
test('future-dated signed package cannot start an attempt, consume a nonce or gain a permit', async () => {
    const { f, challenge } = await enrolled(4810, true);
    const value = receipt(challenge);
    value.receipt.observation.historyFrom = new Date(Date.now() - 60000).toISOString();
    value.receipt.signature = signature(wire.nativeMessage(value.receipt));
    const before = structuredClone(f.state);
    await assert.rejects(execute.executeNativeReceipt(value, f, origin), /X_NATIVE_NOT_DUE/);
    assert.deepEqual(f.state, before); assert.equal(f.state.attempts.length, 0);
});
test('expired unused START refresh returns a complete canonical sanitized stage without renewing lease', async () => {
    const { f, context, challenge } = await enrolled(4807), now = Date.now;
    const leaseBefore = f.state.work[0].lease_expires_at.toISOString();
    try {
        Date.now = () => now() + 31000;
        const refreshed = await control.refreshNativeStart(readProof(challenge, 'refresh'), f, origin);
        assert.equal(refreshed.accepted_text, body);
        assert.equal(refreshed.challenge.phase, 'start');
        assert.ok(refreshed.challenge.nonce !== challenge.nonce);
        assert.equal(f.state.work[0].lease_expires_at.toISOString(), leaseBefore);
        assert.ok(!JSON.stringify(refreshed).includes(context.leaseToken));
        assert.equal(f.state.attempts.length, 0);
    } finally { Date.now = now; }
});
test('wrong origin, settings replacement and revoked installation yield no attempt or permit', async () => {
    for (const mutation of ['origin', 'settings', 'revoke']) {
        const { f, args, challenge } = await enrolled(4802), before = structuredClone(f.state);
        if (mutation === 'settings') {
            const row = f.state.nativeSettings.find(r => r.key.includes('installation'));
            const value = JSON.parse(row.value); value.uatReference = 'Mutated UAT reference not in audit'; row.value = JSON.stringify(value);
        }
        if (mutation === 'revoke') await registry.revokeNativeInstallation({ projectId: args.projectId,
            channelId: args.snapshot.channelId, installationId, actorId: args.actorId, reference: 'Owner revoked synthetic installation' }, f);
        await assert.rejects(execute.executeNativeReceipt(receipt(challenge), f,
            mutation === 'origin' ? `chrome-extension://${'b'.repeat(32)}` : origin));
        assert.equal(f.state.attempts.length, before.attempts.length);
    }
});
test('another current tenant owner can revoke an installation and revocation audit remains sticky', async () => {
    const { f, args, challenge } = await enrolled(4806);
    await registry.revokeNativeInstallation({ projectId: args.projectId, channelId: args.snapshot.channelId,
        installationId, actorId: 'user:5', reference: 'Current tenant owner revokes former owner installation' }, f);
    const row = f.state.nativeSettings.find(r => r.key.includes('installation'));
    const edited = JSON.parse(row.value); edited.revoked = false; row.value = JSON.stringify(edited);
    await assert.rejects(execute.executeNativeReceipt(receipt(challenge), f, origin), /INSTALLATION_AUDIT_REQUIRED/);
    assert.equal(f.state.attempts.length, 0);
});
test('nonce consume rolls back when the canonical attempt audit fails; no partial authority persists', async () => {
    const { f, challenge } = await enrolled(4803), before = structuredClone(f.state);
    f.state.failAudit = true;
    await assert.rejects(execute.executeNativeReceipt(receipt(challenge), f, origin), /audit unavailable/);
    f.state.failAudit = false;
    assert.deepEqual(f.state, before);
});
test('a lost nonce CAS grants no attempt and no consume audit', async () => {
    const { f, challenge } = await enrolled(4805), before = structuredClone(f.state);
    f.db.projectSettings.updateMany = async () => ({ count: 0 });
    await assert.rejects(execute.executeNativeReceipt(receipt(challenge), f, origin), /NONCE_ALREADY_CONSUMED/);
    assert.deepEqual(f.state, before);
});
test('UNKNOWN after start remains one attempt and expired lease yields reconciliation, not a new permit', async () => {
    const { f, context, challenge } = await enrolled(4804);
    await execute.executeNativeReceipt(receipt(challenge), f, origin);
    const permitStage = await advance.advanceNativeChallenge(readProof(challenge, 'advance'), false, f, origin);
    await execute.executeNativeReceipt(receipt(permitStage.challenge), f, origin);
    const resultStage = await advance.advanceNativeChallenge(readProof(permitStage.challenge, 'advance'), false, f, origin);
    await execute.executeNativeReceipt(receipt(resultStage.challenge, true), f, origin);
    f.state.work[0].lease_expires_at = new Date(0);
    const recovered = await advance.advanceNativeChallenge(readProof(resultStage.challenge, 'reconcile'), true, f, origin);
    assert.equal(recovered.challenge.phase, 'reconcile'); assert.equal(recovered.submission_permitted, false);
    assert.equal(f.state.attempts.length, 1);
    await assert.rejects(control.issueNativeChallenge({ context, installationId, bundleSha256,
        phase: 'permit', attemptId: f.state.attempts[0].id }, f));
});
