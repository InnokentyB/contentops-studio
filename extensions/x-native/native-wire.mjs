import { installationKeyPair } from './store.mjs';
import { localKeyProof } from './key.mjs';
import { validatePackage, validateChallenge } from './package.mjs';
function canonical(value) {
    if (value === null || typeof value !== 'object') {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) throw Error('LOCAL_MESSAGE_INVALID');
        return encoded;
    }
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sign(purpose, value) {
    const pair = await installationKeyPair();
    if ((value.bundleSha256 ?? value.challenge?.bundleSha256) !== pair.bundleSha256) throw Error('LOCAL_BUNDLE_MISMATCH');
    return base64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey,
        new TextEncoder().encode(`ContentOps:X-native:${purpose}:v1\n${canonical(value)}`)));
}
export async function publicInstallation() {
    const pair = await installationKeyPair();
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const { fingerprint } = await localKeyProof(pair);
    return { publicKey: { kty, crv, x, y }, installationId: fingerprint, bundleSha256: pair.bundleSha256 };
}
export async function readProof(nonce, operation, packageData) {
    const { projectId, channelId } = validatePackage(packageData);
    if (!/^[a-f0-9]{64}$/.test(nonce || '')) throw Error('LOCAL_NONCE_INVALID');
    if (!['read', 'advance', 'reconcile', 'refresh', 'pair', 'heartbeat'].includes(operation)) throw Error('LOCAL_OPERATION_INVALID');
    const { installationId, bundleSha256 } = await publicInstallation();
    const value = { operation, projectId, channelId, installationId, bundleSha256, nonce, observedAt: new Date().toISOString() };
    return { ...value, signature: await sign('read-challenge', value) };
}
export async function receiptProof(challenge, observation) {
    validateChallenge(challenge);
    const identity = await publicInstallation();
    if (challenge.purpose === 'pair' || challenge.installationId !== identity.installationId
        || challenge.bundleSha256 !== identity.bundleSha256) throw Error('LOCAL_INSTALLATION_MISMATCH');
    const value = { challenge, observation };
    return { ...value, signature: await sign('receipt', value) };
}
export async function textSha(text) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
        byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function pairingProof(challenge, observation) {
    validateChallenge(challenge);
    const identity = await publicInstallation();
    if (challenge.purpose !== 'pair' || challenge.installationId !== identity.installationId
        || challenge.bundleSha256 !== identity.bundleSha256
        || challenge.extensionId !== chrome.runtime.id || observation.account !== challenge.account
        || await textSha(observation.text) !== challenge.bodySha256) throw Error('LOCAL_PAIRING_MISMATCH');
    const value = { challenge, account: observation.account, observedAt: observation.observedAt, bodySha256: challenge.bodySha256 };
    return { ...value, signature: await sign('pairing', value) };
}
