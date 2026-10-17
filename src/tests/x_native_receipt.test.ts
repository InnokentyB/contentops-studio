import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { nativeChallengeSchema, nativePublicKeySchema, nativeKeyFingerprint, nativeMessage,
    nativeReadMessage, verifyNativeReceipt, verifyNativeRead, type NativeReceipt } from '../services/x_native_receipt';

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const raw = keys.publicKey.export({ format: 'jwk' });
const publicKey = nativePublicKeySchema.parse({ kty: raw.kty, crv: raw.crv, x: raw.x, y: raw.y });
const now = Date.parse('2026-10-17T12:00:00Z');
const text = 'Synthetic accepted post';
const bundleSha256 = '8'.repeat(64);
function fixture(taskId = 25) {
    const challenge = nativeChallengeSchema.parse({ version: 1, projectId: 7, taskId, channelId: 8, revision: 2,
        bodySha256: 'a'.repeat(64), manifest: `sha256:${'b'.repeat(64)}`, installationId: nativeKeyFingerprint(publicKey),
        bundleSha256, actorId: 'user:3', workItemId: 9, attemptId: null, phase: 'start', nonce: 'c'.repeat(64),
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString(),
        leaseSha256: 'd'.repeat(64), releaseKeySha256: 'e'.repeat(64), sendKeySha256: 'f'.repeat(64),
        account: '@synthetic', profileUrl: 'https://x.com/synthetic', scheduleAt: '2026-10-16T12:00:00Z' });
    const unsigned = { challenge, observation: { kind: 'editor' as const, observedAt: new Date(now).toISOString(),
        account: '@synthetic', text, editorMode: 'new_post' as const, attachments: 0 as const,
        historyFrom: challenge.scheduleAt, historyThrough: new Date(now).toISOString(), historyComplete: true as const,
        scannedStatuses: 3, duplicateFound: false as const } };
    const receipt = { ...unsigned, signature: sign('sha256', Buffer.from(nativeMessage(unsigned)),
        { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    return { receipt, context: { expectedChallenge: challenge, publicKey, installationId: challenge.installationId,
        bundleSha256, actorId: challenge.actorId, revoked: false, expectedText: text, now } };
}
test('signed generic receipts support distinct data-bound tasks without production identifiers', () => {
    for (const id of [25, 900]) { const f = fixture(id); assert.equal(verifyNativeReceipt(f.receipt, f.context).challenge.taskId, id); }
});
test('forgery, wrong task/account/text, revoked key and expired challenge fail closed', () => {
    const f = fixture();
    for (const patch of [{ challenge: { ...f.receipt.challenge, taskId: 26 } },
        { observation: { ...f.receipt.observation, account: '@foreign' } },
        { observation: { ...f.receipt.observation, text: 'changed' } }]) {
        assert.throws(() => verifyNativeReceipt({ ...f.receipt, ...patch }, f.context));
    }
    assert.throws(() => verifyNativeReceipt(f.receipt, { ...f.context, revoked: true }));
    assert.throws(() => verifyNativeReceipt(f.receipt, { ...f.context, now: now + 30001 }));
});
test('read signatures bind operation, tenant and channel rather than authorizing another action', () => {
    const value = { operation: 'read' as const, projectId: 7, channelId: 8, installationId: nativeKeyFingerprint(publicKey), bundleSha256,
        nonce: 'c'.repeat(64), observedAt: new Date(now).toISOString() };
    const proof = { ...value, signature: sign('sha256', Buffer.from(nativeReadMessage(value)),
        { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    assert.equal(verifyNativeRead(proof, publicKey, now, 'read', bundleSha256).projectId, 7);
    assert.throws(() => verifyNativeRead(proof, publicKey, now, 'advance', bundleSha256));
    assert.throws(() => verifyNativeRead({ ...proof, projectId: 9 }, publicKey, now, 'read', bundleSha256));
    assert.throws(() => verifyNativeRead(proof, publicKey, now, 'read', '9'.repeat(64)), /BUNDLE_MISMATCH/);
});
test('even a valid signing key cannot substitute a different enrolled build digest', () => {
    const f = fixture(), challenge = { ...f.receipt.challenge, bundleSha256: '9'.repeat(64) };
    const unsigned = { challenge, observation: f.receipt.observation };
    const receipt = { ...unsigned, signature: sign('sha256', Buffer.from(nativeMessage(unsigned)),
        { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    assert.throws(() => verifyNativeReceipt(receipt, { ...f.context, expectedChallenge: challenge }), /BUNDLE_MISMATCH/);
});
test('result requires exact author object URL; unknown cannot become an editor permit', () => {
    const f = fixture();
    const unsigned = { challenge: { ...f.receipt.challenge, phase: 'result' as const, attemptId: 10 },
        observation: { kind: 'published' as const, observedAt: new Date(now).toISOString(), account: '@synthetic', text,
            providerObjectId: '123', publicUrl: 'https://x.com/foreign/status/123', publishedAt: new Date(now).toISOString() } };
    const receipt: NativeReceipt = { ...unsigned, signature: sign('sha256', Buffer.from(nativeMessage(unsigned)),
        { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    assert.throws(() => verifyNativeReceipt(receipt, { ...f.context, expectedChallenge: unsigned.challenge }), /RESULT_MISMATCH/);
    assert.throws(() => verifyNativeReceipt({ ...f.receipt, observation: { kind: 'unknown',
        observedAt: new Date(now).toISOString(), reason: 'native_gap' } }, f.context));
});
