const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** Business identity is validated data, never executable authority or an allowlist. */
export function validatePackage(value) {
    if (!value || typeof value !== 'object' || !['projectId', 'taskId', 'channelId', 'revision'].every(key => positive(value[key]))
        || !sha(value.bodySha256) || typeof value.account !== 'string' || !/^@[A-Za-z0-9_]{1,15}$/.test(value.account)
        || typeof value.profileUrl !== 'string' || value.profileUrl !== `https://x.com/${value.account.slice(1)}`
        || typeof value.scheduleAt !== 'string' || !Number.isFinite(Date.parse(value.scheduleAt))) throw Error('LOCAL_PACKAGE_INVALID');
    return Object.fromEntries(['projectId', 'taskId', 'channelId', 'revision', 'bodySha256', 'account', 'profileUrl', 'scheduleAt']
        .map(key => [key, value[key]]));
}
export function assertSamePackage(actual, expected) {
    const a = validatePackage(actual); const b = validatePackage(expected);
    if (Object.keys(a).some(key => a[key] !== b[key])) throw Error('LOCAL_PACKAGE_MISMATCH');
    return a;
}
export function journalKey(kind, value) {
    validatePackage(value);
    if (!['flight', 'click', 'index', 'release-click'].includes(kind)) throw Error('LOCAL_JOURNAL_INVALID');
    const prefix = `native:${kind}:${value.projectId}:${value.taskId}`;
    if (kind === 'index') return prefix;
    if (!sha(value.releaseKeySha256)) throw Error('LOCAL_JOURNAL_INVALID');
    if (kind === 'click' && !positive(value.attemptId)) throw Error('LOCAL_JOURNAL_INVALID');
    return `${prefix}:${value.releaseKeySha256}${kind === 'click' ? `:${value.attemptId}` : ''}`;
}
export function validateChallenge(challenge) {
    validatePackage(challenge);
    if (challenge.version !== 1 || !sha(challenge.nonce) || !sha(challenge.installationId) || !sha(challenge.bundleSha256)
        || !/^sha256:[a-f0-9]{64}$/.test(challenge.manifest || '') || typeof challenge.actorId !== 'string'
        || !challenge.actorId || !Number.isFinite(Date.parse(challenge.issuedAt))
        || !Number.isFinite(Date.parse(challenge.expiresAt))) throw Error('LOCAL_CHALLENGE_INVALID');
    if (challenge.purpose === 'pair') {
        if (!/^[a-p]{32}$/.test(challenge.extensionId || '')) throw Error('LOCAL_CHALLENGE_INVALID');
    } else if (!['start', 'permit', 'result', 'reconcile'].includes(challenge.phase)
        || !positive(challenge.workItemId) || (challenge.attemptId !== null && !positive(challenge.attemptId))
        || ![challenge.leaseSha256, challenge.releaseKeySha256, challenge.sendKeySha256].every(sha)) {
        throw Error('LOCAL_CHALLENGE_INVALID');
    }
    return challenge;
}
