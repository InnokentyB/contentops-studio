import { createHash, createPublicKey, verify } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const nativeBundleSchema = hash;
/** Reviewed build consistency binding only; this is not remote browser/OS attestation. */
export function assertNativeBundle(actual: string, expected: string): void {
    if (!nativeBundleSchema.safeParse(actual).success || actual !== expected) throw new Error('[X_NATIVE_BUNDLE_MISMATCH]');
}
const time = z.string().datetime({ offset: true });
const id = z.number().int().positive();
const account = z.string().regex(/^@[A-Za-z0-9_]{1,15}$/);
export const nativePublicKeySchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/), y: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const nativeChallengeSchema = z.object({ version: z.literal(1), projectId: id, taskId: id, channelId: id,
    revision: id, bodySha256: hash, manifest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    installationId: hash, bundleSha256: nativeBundleSchema, actorId: z.string().regex(/^user:[1-9]\d*$/), workItemId: id,
    attemptId: id.nullable(), phase: z.enum(['start', 'permit', 'result', 'reconcile']), nonce: hash,
    issuedAt: time, expiresAt: time, leaseSha256: hash, releaseKeySha256: hash, sendKeySha256: hash,
    account, profileUrl: z.string().url().max(100), scheduleAt: time }).strict();
const editorSchema = z.object({ kind: z.literal('editor'), observedAt: time, account,
    text: z.string().min(1).max(280), editorMode: z.literal('new_post'), attachments: z.literal(0),
    historyFrom: time, historyThrough: time, historyComplete: z.literal(true),
    scannedStatuses: z.number().int().min(0).max(20), duplicateFound: z.literal(false) }).strict();
const publishedSchema = z.object({ kind: z.literal('published'), observedAt: time, account,
    text: z.string().min(1).max(280), providerObjectId: z.string().regex(/^[1-9]\d{0,30}$/),
    publicUrl: z.string().url().max(200), publishedAt: time }).strict();
const unknownSchema = z.object({ kind: z.literal('unknown'), observedAt: time,
    reason: z.enum(['native_gap', 'readback_timeout', 'account_changed', 'editor_changed', 'local_journal_pending']) }).strict();
export const nativeReceiptSchema = z.object({ challenge: nativeChallengeSchema,
    observation: z.discriminatedUnion('kind', [editorSchema, publishedSchema, unknownSchema]),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
export type NativeChallenge = z.infer<typeof nativeChallengeSchema>;
export type NativeReceipt = z.infer<typeof nativeReceiptSchema>;
export type NativePublicKey = z.infer<typeof nativePublicKeySchema>;

/** Stable, sorted, domain-separated bytes shared with the paired extension. */
export function nativeCanonical(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        const encoded = JSON.stringify(value);
        if (encoded === undefined) throw new Error('[X_NATIVE_INVALID_MESSAGE]');
        return encoded;
    }
    if (Array.isArray(value)) return `[${value.map(nativeCanonical).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${nativeCanonical(record[key])}`).join(',')}}`;
}
export function nativeMessage(value: Pick<NativeReceipt, 'challenge' | 'observation'>) {
    return `ContentOps:X-native:receipt:v1\n${nativeCanonical({ challenge: value.challenge, observation: value.observation })}`;
}
export function nativeKeyFingerprint(input: unknown) {
    const key = createPublicKey({ key: nativePublicKeySchema.parse(input), format: 'jwk' });
    return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}
export function verifyNativeSignature(publicKey: NativePublicKey, message: string, encoded: string): void {
    const key = createPublicKey({ key: nativePublicKeySchema.parse(publicKey), format: 'jwk' });
    const signature = Buffer.from(encoded, 'base64url');
    if (signature.length !== 64 || signature.toString('base64url') !== encoded
        || !verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, signature)) {
        throw new Error('[X_NATIVE_SIGNATURE_INVALID]');
    }
}
export const nativeReadSchema = z.object({ operation: z.enum(['read', 'advance', 'reconcile', 'refresh', 'pair', 'heartbeat']),
    projectId: id, channelId: id, installationId: hash, bundleSha256: nativeBundleSchema, nonce: hash, observedAt: time,
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
type ReadMessage = Omit<z.infer<typeof nativeReadSchema>, 'signature'>;
export function nativeReadMessage(value: ReadMessage) {
    const { operation, projectId, channelId, installationId, bundleSha256, nonce, observedAt } = value;
    return `ContentOps:X-native:read-challenge:v1\n${nativeCanonical({ operation, projectId, channelId, installationId, bundleSha256, nonce, observedAt })}`;
}
export function verifyNativeRead(input: unknown, publicKey: NativePublicKey, now: number, operation: ReadMessage['operation'], expectedBundleSha256: string) {
    const value = nativeReadSchema.parse(input);
    assertNativeBundle(value.bundleSha256, expectedBundleSha256);
    const age = now - Date.parse(value.observedAt);
    if (value.operation !== operation || age < -5000 || age > 30000
        || value.installationId !== nativeKeyFingerprint(publicKey)) throw new Error('[X_NATIVE_SIGNATURE_INVALID]');
    verifyNativeSignature(publicKey, nativeReadMessage(value), value.signature);
    return value;
}
type VerificationContext = { expectedChallenge: NativeChallenge; publicKey: NativePublicKey;
    installationId: string; bundleSha256: string; actorId: string; revoked: boolean; expectedText: string; now: number };
/** Exact accepted body, account, scope and nonce come from canonical transaction state, never the receipt. */
export function verifyNativeReceipt(input: unknown, context: VerificationContext): NativeReceipt {
    const value = nativeReceiptSchema.parse(input), challenge = value.challenge;
    assertNativeBundle(challenge.bundleSha256, context.bundleSha256);
    if (context.revoked || context.actorId !== challenge.actorId || context.installationId !== challenge.installationId
        || nativeKeyFingerprint(context.publicKey) !== context.installationId) throw new Error('[X_NATIVE_INSTALLATION_INVALID]');
    if (!isDeepStrictEqual(challenge, nativeChallengeSchema.parse(context.expectedChallenge))) throw new Error('[X_NATIVE_CHALLENGE_MISMATCH]');
    const issued = Date.parse(challenge.issuedAt), expires = Date.parse(challenge.expiresAt);
    if (!Number.isFinite(context.now) || context.now < issued || context.now >= expires
        || expires <= issued || expires - issued > (challenge.phase === 'permit' ? 15000 : 30000)) {
        throw new Error('[X_NATIVE_CHALLENGE_EXPIRED]');
    }
    const profile = `https://x.com/${challenge.account.slice(1)}`;
    if (challenge.profileUrl !== profile) throw new Error('[X_NATIVE_IDENTITY_INVALID]');
    verifyNativeSignature(context.publicKey, nativeMessage(value), value.signature);
    const o = value.observation, age = context.now - Date.parse(o.observedAt);
    if (age < -5000 || age > 30000) throw new Error('[X_NATIVE_OBSERVATION_STALE]');
    const editor = challenge.phase === 'start' || challenge.phase === 'permit';
    if (o.kind === 'unknown') {
        if (editor) throw new Error('[X_NATIVE_PHASE_MISMATCH]');
        return value;
    }
    if (editor !== (o.kind === 'editor')) throw new Error('[X_NATIVE_PHASE_MISMATCH]');
    if (o.text !== context.expectedText || o.account !== challenge.account) throw new Error('[X_NATIVE_TEXT_MISMATCH]');
    if (o.kind === 'editor') {
        if (context.now < Date.parse(challenge.scheduleAt)) throw new Error('[X_NATIVE_NOT_DUE]');
        if (Date.parse(o.historyFrom) > Date.parse(challenge.scheduleAt)
            || Date.parse(o.historyThrough) < context.now - 30000 || Date.parse(o.historyThrough) > context.now + 5000
            || Date.parse(o.historyFrom) > Date.parse(o.historyThrough)) throw new Error('[X_NATIVE_HISTORY_INCOMPLETE]');
    } else if (o.publicUrl !== `${profile}/status/${o.providerObjectId}`
        || Date.parse(o.publishedAt) < Date.parse(challenge.scheduleAt)
        || Date.parse(o.publishedAt) > context.now + 5000) throw new Error('[X_NATIVE_RESULT_MISMATCH]');
    return value;
}
