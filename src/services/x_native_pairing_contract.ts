import { z } from 'zod';
import { browserRequestSchema, hash, object, snapshotHash, type BrowserDb } from './browser_publication_contract';
import { nativeChallengeSchema, nativePublicKeySchema, nativeKeyFingerprint } from './x_native_receipt';

export const nativePairingChallengeSchema = nativeChallengeSchema.omit({ workItemId: true, attemptId: true,
    phase: true, leaseSha256: true, releaseKeySha256: true, sendKeySha256: true }).extend({
    purpose: z.literal('pair'), extensionId: z.string().regex(/^[a-p]{32}$/) }).strict();
export const pairingStoredSchema = z.object({ challenge: nativePairingChallengeSchema, context: browserRequestSchema,
    publicKey: nativePublicKeySchema, verifiedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), consumed: z.boolean(),
    recoveryRoot: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type PairingState = z.infer<typeof pairingStoredSchema>;
export const pairingKey = (nonce: string): string => `x_native:pairing:v1:${hash(nonce)}`;
export const pairingEnrollmentWindowMs = 86400000;
/** Signed observation freshness remains five minutes; delayed enrollment is a separate gate. */
export function validPairingTime(challenge: PairingState['challenge']): void {
    const issued = Date.parse(challenge.issuedAt), expires = Date.parse(challenge.expiresAt), now = Date.now();
    if (now < issued || now >= expires || expires <= issued || expires - issued > 300000) throw new Error('[X_NATIVE_PAIRING_EXPIRED]');
}
/** Mutable pairing state must agree with its immutable issuance and public-key audit. */
export async function auditedPairing(tx: BrowserDb, state: PairingState): Promise<void> {
    const event = await tx.workflowEvent.findFirst({ where: { project_id: state.context.projectId,
        content_item_id: state.context.taskId, actor_id: state.context.actorId,
        command: 'x_native_issue_pairing', idempotency_key: hash(state.challenge.nonce) } });
    const recovery = state.recoveryRoot ? await tx.workflowEvent.findFirst({ where: { project_id: state.context.projectId,
        content_item_id: state.context.taskId, actor_id: state.context.actorId, command: 'x_native_recover_pairing',
        idempotency_key: state.recoveryRoot } }) : null;
    const audit = state.recoveryRoot ? object(recovery?.after_state) : object(event?.after_state);
    if (audit.challenge_sha256 !== hash(JSON.stringify(state.challenge))
        || audit.snapshot_sha256 !== snapshotHash(state.context.snapshot)
        || (state.recoveryRoot && audit.successor_nonce_sha256 !== hash(state.challenge.nonce))
        || nativeKeyFingerprint(state.publicKey) !== state.challenge.installationId) throw new Error('[X_NATIVE_PAIRING_AUDIT_REQUIRED]');
}
/** Supersession is a separate durable relation; signed predecessor bytes remain immutable. */
export async function notSupersededPairing(tx: BrowserDb, state: PairingState): Promise<void> {
    if (await tx.workflowEvent.findFirst({ where: { project_id: state.context.projectId,
        content_item_id: state.context.taskId, command: 'x_native_recover_pairing', idempotency_key: hash(state.challenge.nonce) } })) {
        throw new Error('[X_NATIVE_PAIRING_SUPERSEDED]');
    }
}
/** Only timely server-verified, unchanged evidence is eligible for delayed enrollment/recovery. */
export async function verifiedPairing(tx: BrowserDb, state: PairingState): Promise<void> {
    await auditedPairing(tx, state); await notSupersededPairing(tx, state);
    const issued = Date.parse(state.challenge.issuedAt), expires = Date.parse(state.challenge.expiresAt), now = Date.now();
    if (now < issued || now >= issued + pairingEnrollmentWindowMs || expires <= issued || expires - issued > 300000) {
        throw new Error('[X_NATIVE_PAIRING_ENROLLMENT_EXPIRED]');
    }
    const event = await tx.workflowEvent.findFirst({ where: { project_id: state.context.projectId,
        content_item_id: state.context.taskId, actor_id: state.context.actorId,
        command: 'x_native_pairing_verified', idempotency_key: hash(state.challenge.nonce) } });
    const observed = event?.created_at instanceof Date ? event.created_at.getTime() : NaN;
    if (state.consumed || !state.verifiedSha256 || !Number.isFinite(observed) || observed < issued || observed >= expires || observed > now
        || object(event?.after_state).pairing_sha256 !== hash(JSON.stringify(state))) throw new Error('[X_NATIVE_PAIRING_INVALID]');
}
