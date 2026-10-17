import { journal } from './store.mjs';
import { textSha } from './native-wire.mjs';
import { journalKey } from './package.mjs';
/** Permanent per-release and per-attempt markers precede the sole native invocation. Never cleared. */
export async function nativeClickOnce(permit, invokeBoundNativeClick) {
    if (permit.submissionPermitted !== true || !Number.isSafeInteger(permit.attemptId) || permit.attemptId < 1
        || permit.serverAttemptId !== permit.attemptId || !/^[a-f0-9]{64}$/.test(permit.nonce || '')
        || !Number.isFinite(Date.parse(permit.expiresAt)) || Date.now() >= Date.parse(permit.expiresAt)
        || Date.parse(permit.expiresAt) > Date.now() + 15000) throw Error('LOCAL_PERMIT_INVALID');
    const marker = { attemptId: permit.attemptId, nonceSha256: await textSha(permit.nonce), clickStartedAt: new Date().toISOString() };
    await journal('add', journalKey('release-click', permit), marker);
    await journal('add', journalKey('click', permit), marker);
    if (Date.now() >= Date.parse(permit.expiresAt)) throw Error('LOCAL_PERMIT_EXPIRED');
    return invokeBoundNativeClick();
}
