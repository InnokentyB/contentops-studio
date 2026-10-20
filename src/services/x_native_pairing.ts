import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { browserRequestSchema, browserDefaults, checkedBrowserContext, hash, object, snapshotHash,
    type BrowserDb, type BrowserDependencies, type BrowserRequest } from './browser_publication_contract';
import { nativePublicKeySchema, nativeKeyFingerprint, nativeCanonical,
    nativeReadSchema, verifyNativeRead, verifyNativeSignature, nativeBundleSchema, assertNativeBundle } from './x_native_receipt';
import { requireNativeSnapshot, type NativeInstallation } from './x_native_registry';
import { assertNativeExtensionOrigin } from './x_native_origin';
import { nativePairingChallengeSchema, pairingStoredSchema as storedSchema, pairingKey as key, validPairingTime as validTime,
    auditedPairing as audited, notSupersededPairing, verifiedPairing } from './x_native_pairing_contract';
import { pairingRecoverySchema, recoverPairing } from './x_native_pairing_recovery';
export { nativePairingChallengeSchema } from './x_native_pairing_contract';

const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
export const nativePairingIssueSchema = browserRequestSchema.safeExtend({ publicKey: nativePublicKeySchema,
    installationId: z.string().regex(/^[a-f0-9]{64}$/), bundleSha256: nativeBundleSchema, extensionId: z.string().regex(/^[a-p]{32}$/), recovery: pairingRecoverySchema.optional() });
export const nativePairingProofSchema = z.object({ challenge: nativePairingChallengeSchema,
    account: z.string().regex(/^@[A-Za-z0-9_]{1,15}$/), observedAt: z.string().datetime({ offset: true }),
    bodySha256: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
export function nativePairingMessage(input: Omit<z.infer<typeof nativePairingProofSchema>, 'signature'>) {
    return `ContentOps:X-native:pairing:v1\n${nativeCanonical(input)}`;
}
export async function issueNativePairing(input: unknown, deps: BrowserDependencies = browserDefaults) {
    const a = nativePairingIssueSchema.parse(input); requireNativeSnapshot(a.snapshot);
    if (nativeKeyFingerprint(a.publicKey) !== a.installationId) throw new Error('[X_NATIVE_INSTALLATION_INVALID]');
    return deps.db.$transaction(async tx => {
        await checkedBrowserContext(tx, a, deps);
        if (a.recovery) return recoverPairing(tx, a, deps);
        if (await tx.workflowEvent.count({ where: { project_id: a.projectId, content_item_id: a.taskId,
            actor_id: a.actorId, command: 'x_native_issue_pairing' } }) >= 3) throw new Error('[X_NATIVE_PAIRING_LIMIT]');
        const now = Date.now(), s = a.snapshot;
        const challenge = nativePairingChallengeSchema.parse({ version: 1, purpose: 'pair', projectId: a.projectId,
            taskId: a.taskId, channelId: s.channelId, revision: s.contentRevision, bodySha256: s.bodySha256,
            manifest: s.manifestChecksum, account: s.identity.accountRef, profileUrl: s.identity.profileUrl,
            scheduleAt: s.scheduleAt, installationId: a.installationId, bundleSha256: a.bundleSha256, actorId: a.actorId, extensionId: a.extensionId,
            nonce: randomBytes(32).toString('hex'), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() });
        const context = browserRequestSchema.parse(Object.fromEntries(Object.entries(a).filter(([name]) =>
            !['publicKey', 'installationId', 'extensionId', 'bundleSha256', 'recovery'].includes(name))));
        await tx.projectSettings.create({ data: { project_id: a.projectId, key: key(challenge.nonce),
            value: JSON.stringify({ challenge, context, publicKey: a.publicKey, verifiedSha256: null, consumed: false }) } });
        await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, actor_id: a.actorId,
            command: 'x_native_issue_pairing', idempotency_key: hash(challenge.nonce),
            after_state: { installation_id: a.installationId, bundle_sha256: a.bundleSha256, challenge_sha256: hash(JSON.stringify(challenge)),
                snapshot_sha256: snapshotHash(s), publication_authorized: false } } });
        return { mode: 'pairing_challenge', challenge, publication_authorized: false };
    }, serial);
}
export async function readNativePairing(input: unknown, deps: BrowserDependencies = browserDefaults, origin?: string) {
    const request = nativeReadSchema.parse(input);
    return deps.db.$transaction(async tx => {
        const row = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: request.projectId, key: key(request.nonce) } } });
        if (!row) throw new Error('[X_NATIVE_PAIRING_REQUIRED]');
        const state = storedSchema.parse(JSON.parse(row.value)); validTime(state.challenge); await audited(tx, state); await notSupersededPairing(tx, state);
        assertNativeExtensionOrigin(origin, state.challenge.extensionId);
        verifyNativeRead(request, state.publicKey, Date.now(), 'pair', state.challenge.bundleSha256);
        if (state.consumed || request.channelId !== state.challenge.channelId
            || request.installationId !== state.challenge.installationId) throw new Error('[X_NATIVE_PAIRING_REQUIRED]');
        const task = await checkedBrowserContext(tx, state.context, deps);
        return { challenge: state.challenge, accepted_text: task.draft_text, already_verified: state.verifiedSha256 !== null,
            publication_authorized: false };
    }, serial);
}
export async function verifyNativePairing(input: unknown, deps: BrowserDependencies = browserDefaults, origin?: string) {
    const proof = nativePairingProofSchema.parse(input);
    return deps.db.$transaction(async tx => {
        const row = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: proof.challenge.projectId, key: key(proof.challenge.nonce) } } });
        if (!row) throw new Error('[X_NATIVE_PAIRING_REQUIRED]');
        const state = storedSchema.parse(JSON.parse(row.value)); validTime(state.challenge); await audited(tx, state); await notSupersededPairing(tx, state);
        assertNativeExtensionOrigin(origin, state.challenge.extensionId);
        await checkedBrowserContext(tx, state.context, deps);
        const { signature, ...message } = proof, age = Date.now() - Date.parse(proof.observedAt);
        if (state.consumed || !isDeepStrictEqual(proof.challenge, state.challenge) || age < -5000 || age > 30000
            || proof.account !== state.challenge.account || proof.bodySha256 !== state.challenge.bodySha256) throw new Error('[X_NATIVE_PAIRING_INVALID]');
        verifyNativeSignature(state.publicKey, nativePairingMessage(message), signature);
        const verifiedSha256 = hash(JSON.stringify(proof));
        if (state.verifiedSha256) {
            if (state.verifiedSha256 !== verifiedSha256) throw new Error('[X_NATIVE_PAIRING_ALREADY_VERIFIED]');
            return { mode: 'pairing_verified', replayed: true, publication_authorized: false };
        }
        const next = { ...state, verifiedSha256 };
        if ((await tx.projectSettings.updateMany({ where: { id: row.id, value: row.value }, data: { value: JSON.stringify(next) } })).count !== 1) {
            throw new Error('[X_NATIVE_PAIRING_ALREADY_VERIFIED]');
        }
        await tx.workflowEvent.create({ data: { project_id: state.context.projectId, content_item_id: state.context.taskId,
            actor_id: state.context.actorId, command: 'x_native_pairing_verified', idempotency_key: hash(proof.challenge.nonce),
            after_state: { pairing_sha256: hash(JSON.stringify(next)), publication_authorized: false } } });
        return { mode: 'pairing_verified', publication_authorized: false };
    }, serial);
}
/** Consume proof inside the same enrollment transaction; a caller attestation cannot replace it. */
export async function consumeNativePairing(tx: BrowserDb, a: BrowserRequest & { pairingNonce?: string; bundleSha256: string },
    installation: NativeInstallation, deps: BrowserDependencies, consume = true) {
    if (!a.pairingNonce) throw new Error('[X_NATIVE_PAIRING_REQUIRED]');
    const row = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId, key: key(a.pairingNonce) } } });
    if (!row) throw new Error('[X_NATIVE_PAIRING_REQUIRED]');
    const state = storedSchema.parse(JSON.parse(row.value)); await verifiedPairing(tx, state);
    assertNativeBundle(state.challenge.bundleSha256, installation.bundleSha256);
    assertNativeBundle(a.bundleSha256, installation.bundleSha256);
    await checkedBrowserContext(tx, state.context, deps);
    const audit = await tx.workflowEvent.findFirst({ where: { project_id: a.projectId, content_item_id: a.taskId,
        actor_id: a.actorId, command: 'x_native_pairing_verified', idempotency_key: hash(a.pairingNonce) } });
    if (state.consumed || !state.verifiedSha256 || state.context.projectId !== a.projectId || state.context.taskId !== a.taskId
        || state.context.actorId !== a.actorId || !isDeepStrictEqual(state.context.snapshot, a.snapshot)
        || state.challenge.channelId !== installation.channelId || state.challenge.installationId !== installation.installationId
        || state.challenge.extensionId !== installation.extensionId || !isDeepStrictEqual(state.publicKey, installation.publicKey)
        || object(audit?.after_state).pairing_sha256 !== hash(JSON.stringify(state))) throw new Error('[X_NATIVE_PAIRING_INVALID]');
    if (consume && (await tx.projectSettings.updateMany({ where: { id: row.id, value: row.value },
        data: { value: JSON.stringify({ ...state, consumed: true }) } })).count !== 1) throw new Error('[X_NATIVE_PAIRING_ALREADY_CONSUMED]');
    return hash(a.pairingNonce);
}
