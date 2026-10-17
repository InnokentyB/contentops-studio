import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { nativePublicKeySchema, nativeKeyFingerprint, nativeReadSchema, nativeChallengeSchema } from '../services/x_native_receipt';
import { nativePairingIssueSchema } from '../services/x_native_pairing';
import { nativeRegistrationSchema, nativeInstallationSchema } from '../services/x_native_registry';
import { nativeIssueSchema } from '../services/x_native_control';

const raw = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
const publicKey = nativePublicKeySchema.parse({ kty: raw.kty, crv: raw.crv, x: raw.x, y: raw.y });
const installationId = nativeKeyFingerprint(publicKey), bundleSha256 = '8'.repeat(64), extensionId = 'a'.repeat(32);
const owner = { projectId: 7, taskId: 25, actorId: 'user:3', approvalReference: 'Synthetic owner approved package', idempotencyKey: 'fixture',
    snapshot: { projectId: 7, taskId: 25, channelId: 8, contentRevision: 2, bodySha256: 'a'.repeat(64),
        scheduleAt: '2026-10-16T12:00:00Z', publishAt: '2026-10-16T12:00:00Z', selectedAssetId: null, assetSha256: null,
        decisionId: 11, decisionVersion: 1, manifestChecksum: `sha256:${'b'.repeat(64)}`, contentLanguage: 'en',
        identity: { platform: 'x', accountType: 'personal', accountRef: '@synthetic', profileUrl: 'https://x.com/synthetic',
            providerAccountId: 'synthetic', registryReference: 'Synthetic owner registry reference', registryEvidenceSha256: 'c'.repeat(64) } } };
const issuedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 30000).toISOString();
const challenge = { version: 1, projectId: 7, taskId: 25, channelId: 8, revision: 2, bodySha256: 'a'.repeat(64),
    manifest: owner.snapshot.manifestChecksum, installationId, actorId: owner.actorId, workItemId: 9, attemptId: null,
    phase: 'start', nonce: 'd'.repeat(64), issuedAt, expiresAt, leaseSha256: 'e'.repeat(64),
    releaseKeySha256: 'f'.repeat(64), sendKeySha256: '1'.repeat(64), account: '@synthetic',
    profileUrl: 'https://x.com/synthetic', scheduleAt: owner.snapshot.scheduleAt };

test('pairing and registration require an exact build digest, rejecting legacy missing identities', () => {
    const common = { ...owner, publicKey, installationId, extensionId };
    assert.equal(nativePairingIssueSchema.safeParse(common).success, false);
    assert.equal(nativePairingIssueSchema.safeParse({ ...common, bundleSha256 }).success, true);
    const registration = { ...common, uatReference: 'Explicit synthetic no-send owner UAT' };
    assert.equal(nativeRegistrationSchema.safeParse(registration).success, false);
    assert.equal(nativeRegistrationSchema.safeParse({ ...registration, bundleSha256 }).success, true);
    for (const digest of ['', 'not-a-digest', 'A'.repeat(64), null]) {
        assert.equal(nativeRegistrationSchema.safeParse({ ...registration, bundleSha256: digest }).success, false);
    }
});
test('stored enrollment and owner challenge issuance reject legacy missing digests', () => {
    const record = { projectId: 7, channelId: 8, actorId: owner.actorId, installationId, publicKey, extensionId,
        uatReference: 'Explicit synthetic no-send owner UAT', revoked: false };
    assert.equal(nativeInstallationSchema.safeParse(record).success, false);
    assert.equal(nativeInstallationSchema.safeParse({ ...record, bundleSha256 }).success, true);
    const issue = { context: { ...owner, workItemId: 9, leaseToken: 'synthetic-lease-token-long' }, installationId,
        phase: 'start', attemptId: null };
    assert.equal(nativeIssueSchema.safeParse(issue).success, false);
    assert.equal(nativeIssueSchema.safeParse({ ...issue, bundleSha256 }).success, true);
});
test('all execution challenges and signed reads carry build identity; old wire fails closed', () => {
    assert.equal(nativeChallengeSchema.safeParse(challenge).success, false);
    assert.equal(nativeChallengeSchema.safeParse({ ...challenge, bundleSha256 }).success, true);
    const read = { projectId: 7, channelId: 8, operation: 'read', installationId, nonce: challenge.nonce,
        observedAt: issuedAt, signature: 'a'.repeat(86) };
    assert.equal(nativeReadSchema.safeParse(read).success, false);
    assert.equal(nativeReadSchema.safeParse({ ...read, bundleSha256 }).success, true);
});
