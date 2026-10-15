import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const root = new URL('../../extensions/x-native/', import.meta.url);
test('X-NATIVE-01 compatibility build has no provider, network, content-script or background capability', async () => {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions ?? [], []);
    assert.deepEqual(manifest.host_permissions ?? [], []);
    for (const field of ['content_scripts', 'background', 'externally_connectable']) assert.equal(manifest[field], undefined);
    assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});
test('X-NATIVE-02 private key cannot export, public challenge verifies, altered challenge fails', async () => {
    const { createInstallationKey, localKeyProof } = await import(new URL('key.mjs', root));
    const pair = await createInstallationKey(webcrypto.subtle);
    assert.equal(pair.privateKey.extractable, false);
    await assert.rejects(webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
    const proof = await localKeyProof(pair, webcrypto.subtle);
    assert.equal(proof.verified, true);
    assert.match(proof.fingerprint, /^[a-f0-9]{64}$/);
    const message = new TextEncoder().encode('different-message');
    assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
        proof.signature, message), false);
});
