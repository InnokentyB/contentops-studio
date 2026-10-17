import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { hash, object, type BrowserDb, type BrowserDependencies } from './browser_publication_contract';
import { browserBoundarySchema, checkedBrowserRelease, assertBrowserLease, type BrowserBoundary } from './browser_publication_guard';
import { nativeChallengeSchema, nativeReceiptSchema, verifyNativeReceipt, assertNativeBundle, type NativeChallenge } from './x_native_receipt';
import { installedNative, requireNativeSnapshot } from './x_native_registry';
import { assertNativeExtensionOrigin } from './x_native_origin';

const { leaseToken: omittedLease, ...safeShape } = browserBoundarySchema.shape;
export const nativeStoredSchema = z.object({ challenge: nativeChallengeSchema, context: z.object(safeShape).strict(),
    consumedSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
export type NativeState = z.infer<typeof nativeStoredSchema>;
export const nativeChallengeKey = (nonce: string) => `x_native:challenge:v1:${hash(nonce)}`;
export const nativePhaseKey = (c: Pick<NativeChallenge, 'taskId' | 'workItemId' | 'phase' | 'attemptId' | 'releaseKeySha256'>) => {
    const attemptSegment = c.attemptId === null ? 'none' : String(c.attemptId);
    return `x_native:phase:v1:${c.taskId}:${c.workItemId}:${c.releaseKeySha256}:${c.phase}:${attemptSegment}`;
};
export function safeNativeContext(a: BrowserBoundary): NativeState['context'] {
    const { leaseToken: privateFence, ...safe } = a;
    return z.object(safeShape).strict().parse(safe);
}
export async function loadNativeState(tx: BrowserDb, projectId: number, nonce: string) {
    const row = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: projectId, key: nativeChallengeKey(nonce) } } });
    if (!row) throw new Error('[X_NATIVE_CHALLENGE_REQUIRED]');
    const state = nativeStoredSchema.parse(JSON.parse(row.value)), c = state.challenge;
    if (c.projectId !== projectId || c.nonce !== nonce || state.context.projectId !== projectId
        || state.context.taskId !== c.taskId || state.context.snapshot.channelId !== c.channelId) throw new Error('[X_NATIVE_CHALLENGE_MISMATCH]');
    const audit = await tx.workflowEvent.findFirst({ where: { project_id: projectId, content_item_id: c.taskId,
        work_item_id: c.workItemId, actor_id: c.actorId, command: 'x_native_issue_challenge', idempotency_key: hash(nonce) } });
    if (object(audit?.after_state).challenge_sha256 !== hash(JSON.stringify(c))
        || object(audit?.after_state).context_sha256 !== hash(JSON.stringify(state.context))) throw new Error('[X_NATIVE_CHALLENGE_AUDIT_REQUIRED]');
    return { row, state };
}
export async function nativeBoundary(tx: BrowserDb, args: BrowserBoundary, deps: BrowserDependencies, historical = false) {
    requireNativeSnapshot(args.snapshot);
    const found = await checkedBrowserRelease(tx, args, deps);
    if (historical) {
        if (found.work.lease_actor_id !== args.actorId || !found.work.lease_token
            || hash(found.work.lease_token) !== hash(args.leaseToken)) throw new Error('[BROWSER_ATTEMPT_SCOPE_MISMATCH]');
    } else assertBrowserLease(found.work, args);
    if (typeof found.proof.release_key !== 'string') throw new Error('[BROWSER_RELEASE_PROOF_INVALID]');
    return found;
}
export async function nativeAttempts(tx: BrowserDb, a: BrowserBoundary, phase: NativeChallenge['phase'], attemptId: number | null) {
    const attempts = await tx.deliveryAttempt.findMany({ where: { project_id: a.projectId, content_item_id: a.taskId } });
    if (phase === 'start' ? attempts.length !== 0 || attemptId !== null
        : attempts.length !== 1 || attempts[0].id !== attemptId || attempts[0].channel_id !== a.snapshot.channelId
            || attempts[0].idempotency_key !== a.idempotencyKey || attempts[0].status !== 'pending'
            || (phase === 'permit' && Boolean(attempts[0].error_message))) throw new Error('[X_NATIVE_ATTEMPT_MISMATCH]');
    return attempts;
}
export async function restoredNativeContext(tx: BrowserDb, state: NativeState): Promise<BrowserBoundary> {
    const c = state.challenge;
    const work = await tx.workItem.findFirst({ where: { id: c.workItemId, project_id: c.projectId, content_item_id: c.taskId } });
    if (!work?.lease_token || hash(work.lease_token) !== c.leaseSha256) throw new Error('[X_NATIVE_CHALLENGE_MISMATCH]');
    return browserBoundarySchema.parse({ ...state.context, leaseToken: work.lease_token });
}
/** Only called by NativeGate inside the SAME attempt/permit/fact transaction. */
export async function consumeNativeReceipt(tx: BrowserDb, input: unknown, args: BrowserBoundary,
    expectedPhase: NativeChallenge['phase'], deps: BrowserDependencies, origin?: string) {
    const receipt = nativeReceiptSchema.parse(input), c = receipt.challenge;
    const { row, state } = await loadNativeState(tx, args.projectId, c.nonce);
    if (c.phase !== expectedPhase || !isDeepStrictEqual(safeNativeContext(args), state.context)) throw new Error('[X_NATIVE_CHALLENGE_MISMATCH]');
    const current = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: args.projectId, key: nativePhaseKey(c) } } });
    if (current?.value !== hash(c.nonce)) throw new Error('[X_NATIVE_CHALLENGE_SUPERSEDED]');
    const { task, work, proof } = await nativeBoundary(tx, args, deps, c.phase === 'reconcile');
    const registration = await installedNative(tx, { projectId: args.projectId, channelId: args.snapshot.channelId,
        actorId: args.actorId, installationId: c.installationId });
    assertNativeExtensionOrigin(origin, registration.extensionId);
    assertNativeBundle(c.bundleSha256, registration.bundleSha256);
    await nativeAttempts(tx, args, c.phase, c.attemptId);
    if (c.workItemId !== work.id || c.actorId !== args.actorId || c.leaseSha256 !== hash(args.leaseToken)
        || c.releaseKeySha256 !== hash(String(proof.release_key)) || c.sendKeySha256 !== hash(args.idempotencyKey)) throw new Error('[X_NATIVE_CHALLENGE_MISMATCH]');
    verifyNativeReceipt(receipt, { expectedChallenge: state.challenge, publicKey: registration.publicKey,
        installationId: registration.installationId, bundleSha256: registration.bundleSha256, actorId: args.actorId, revoked: registration.revoked,
        expectedText: task.draft_text || '', now: Date.now() });
    const receiptHash = hash(JSON.stringify(receipt));
    if (state.consumedSha256 !== null) throw new Error('[X_NATIVE_NONCE_ALREADY_CONSUMED]');
    if ((await tx.projectSettings.updateMany({ where: { id: row.id, value: row.value },
        data: { value: JSON.stringify({ ...state, consumedSha256: receiptHash }) } })).count !== 1) throw new Error('[X_NATIVE_NONCE_ALREADY_CONSUMED]');
    await tx.workflowEvent.create({ data: { project_id: args.projectId, content_item_id: args.taskId, work_item_id: work.id,
        actor_id: args.actorId, command: 'x_native_consume_receipt', idempotency_key: hash(c.nonce),
        after_state: { phase: c.phase, attempt_id: c.attemptId, installation_id: registration.installationId,
            bundle_sha256: registration.bundleSha256,
            receipt_sha256: receiptHash, nonce_sha256: hash(c.nonce) } } });
    return { receipt, receiptHash };
}
