import { z } from 'zod';
import { browserDefaults, hash, paragraphHashes, type BrowserDependencies } from './browser_publication_contract';
import { startBrowserSubmission, preSubmitBrowserSubmission, markBrowserSubmissionUncertain } from './browser_publication_execution';
import { confirmBrowserSubmission, reconcileBrowserSubmission } from './browser_publication_confirmation';
import type { NativeGate } from './browser_publication_native';
import { nativeReceiptSchema } from './x_native_receipt';
import { consumeNativeReceipt, loadNativeState, restoredNativeContext, nativeBoundary } from './x_native_state';
import { installedNative, nativeSerial } from './x_native_registry';
import { verifyNativeReceipt, assertNativeBundle } from './x_native_receipt';
import { assertNativeExtensionOrigin } from './x_native_origin';

export const nativeExecutionSchema = z.object({ receipt: nativeReceiptSchema }).strict();
/** Only signed executor receipts may mutate X lifecycle. Every nonce CAS is inside the mutation transaction. */
export async function executeNativeReceipt(input: unknown, deps: BrowserDependencies = browserDefaults, origin?: string) {
    const { receipt } = nativeExecutionSchema.parse(input), c = receipt.challenge;
    // The HTTP caller never receives or supplies a lease. Resolve it from the audited nonce internally.
    const context = await deps.db.$transaction(async tx => {
        const { state } = await loadNativeState(tx, c.projectId, c.nonce);
        const installation = await installedNative(tx, { projectId: c.projectId, channelId: c.channelId,
            actorId: c.actorId, installationId: c.installationId });
        assertNativeExtensionOrigin(origin, installation.extensionId);
        assertNativeBundle(c.bundleSha256, installation.bundleSha256);
        const boundary = await restoredNativeContext(tx, state);
        const { task } = await nativeBoundary(tx, boundary, deps, c.phase === 'reconcile');
        verifyNativeReceipt(receipt, { expectedChallenge: state.challenge, publicKey: installation.publicKey,
            installationId: installation.installationId, bundleSha256: installation.bundleSha256, actorId: boundary.actorId, revoked: installation.revoked,
            expectedText: task.draft_text || '', now: Date.now() });
        return boundary;
    }, nativeSerial);
    if (c.projectId !== context.projectId || c.taskId !== context.taskId || c.actorId !== context.actorId
        || c.workItemId !== context.workItemId || c.channelId !== context.snapshot.channelId) throw new Error('[X_NATIVE_CHALLENGE_MISMATCH]');
    const gate: NativeGate = async (tx, phase) => {
        const expected = receipt.observation.kind === 'unknown' ? 'unknown'
            : c.phase === 'result' ? 'result' : c.phase;
        if (phase !== expected) throw new Error('[X_NATIVE_PHASE_MISMATCH]');
        await consumeNativeReceipt(tx, receipt, context, c.phase, deps, origin);
    };
    if (c.phase === 'start') {
        if (c.attemptId !== null || receipt.observation.kind !== 'editor') throw new Error('[X_NATIVE_PHASE_MISMATCH]');
        return startBrowserSubmission(context, deps, gate);
    }
    if (!c.attemptId) throw new Error('[X_NATIVE_ATTEMPT_MISMATCH]');
    const o = receipt.observation;
    if (o.kind === 'unknown') {
        if (c.phase !== 'result' && c.phase !== 'reconcile') throw new Error('[X_NATIVE_PHASE_MISMATCH]');
        return markBrowserSubmissionUncertain({ ...context, attemptId: c.attemptId,
            reasonCode: 'PROVIDER_RESULT_UNCERTAIN' }, deps, gate);
    }
    const observed = { ...context, attemptId: c.attemptId, observedProfileUrl: c.profileUrl,
        observedProviderAccountId: context.snapshot.identity.providerAccountId, observedAccountType: 'personal' as const,
        observedBodySha256: hash(o.text), observedAssetSha256: null, paragraphBlockSha256: paragraphHashes(o.text),
        attachedImageCount: 0, duplicateAbsent: true, evidenceSha256: hash(JSON.stringify(receipt)) };
    if (c.phase === 'permit') {
        if (o.kind !== 'editor') throw new Error('[X_NATIVE_PHASE_MISMATCH]');
        return { ...await preSubmitBrowserSubmission(observed, deps, gate), expires_at: c.expiresAt, native_receipt_required: true };
    }
    if (o.kind !== 'published') throw new Error('[X_NATIVE_PHASE_MISMATCH]');
    const result = { ...observed, publicUrl: o.publicUrl, providerObjectId: o.providerObjectId, publishedAt: o.publishedAt };
    if (c.phase === 'reconcile') {
        const { leaseToken: privateFence, ...historical } = result;
        return reconcileBrowserSubmission(historical, deps, undefined, gate);
    }
    return confirmBrowserSubmission(result, deps, undefined, gate);
}
