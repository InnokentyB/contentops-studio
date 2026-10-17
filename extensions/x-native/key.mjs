const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
const localMessage = new TextEncoder().encode('ContentOps:X-native:local-no-send-check:v1');

export function createInstallationKey(subtle = crypto.subtle) {
    return subtle.generateKey(algorithm, false, ['sign', 'verify']);
}

/** Fixed local challenge only. This is NOT a server admission or provider receipt. */
export async function localKeyProof(pair, subtle = crypto.subtle) {
    if (pair.privateKey.extractable || pair.privateKey.type !== 'private'
        || pair.privateKey.algorithm.name !== 'ECDSA'
        || pair.privateKey.algorithm.namedCurve !== 'P-256') throw new Error('LOCAL_KEY_INVALID');
    const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, localMessage);
    const verified = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, signature, localMessage);
    if (!verified) throw new Error('LOCAL_KEY_VERIFICATION_FAILED');
    const publicBytes = await subtle.exportKey('spki', pair.publicKey);
    const hash = new Uint8Array(await subtle.digest('SHA-256', publicBytes));
    return { verified, signature, fingerprint: Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') };
}
