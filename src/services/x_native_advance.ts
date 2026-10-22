import { browserDefaults, object, requireBrowserOwner, type BrowserDependencies } from './browser_publication_contract';
import { nativeReadSchema, verifyNativeRead, assertNativeBundle, type NativeChallenge } from './x_native_receipt';
import { installedNative, nativeSerial } from './x_native_registry';
import { nativeBoundary, loadNativeState, restoredNativeContext, safeNativeContext,scopedNativeAttempts } from './x_native_state';
import { issueNativeChallenge } from './x_native_control';
import { assertNativeExtensionOrigin } from './x_native_origin';

/** Advance the same durable execution only. UNKNOWN/expired leases can only produce readback challenges. */
export async function advanceNativeChallenge(input: unknown, reconcileOnly = false, deps: BrowserDependencies = browserDefaults, origin?: string) {
    const request = nativeReadSchema.parse(input);
    const next = await deps.db.$transaction(async tx => {
        const { state } = await loadNativeState(tx, request.projectId, request.nonce), c = state.challenge;
        const registration = await installedNative(tx, { projectId: c.projectId, channelId: c.channelId,
            actorId: c.actorId, installationId: c.installationId });
        assertNativeExtensionOrigin(origin, registration.extensionId);
        assertNativeBundle(c.bundleSha256, registration.bundleSha256);
        verifyNativeRead(request, registration.publicKey, Date.now(), reconcileOnly ? 'reconcile' : 'advance', registration.bundleSha256);
        if (request.channelId !== c.channelId || request.installationId !== c.installationId) throw new Error('[X_NATIVE_INSTALLATION_INVALID]');
        await requireBrowserOwner(tx, state.context);
        const attempts = await scopedNativeAttempts(tx,state.context);
        if (reconcileOnly && c.phase === 'start' && c.attemptId === null && !state.consumedSha256 && attempts.length === 0) {
            const context = await restoredNativeContext(tx, state);
            const { task } = await nativeBoundary(tx, context, deps);
            return { prestart: { mode: 'prestart_recovery', context: safeNativeContext(context), challenge: c, accepted_text: task.draft_text,
                submission_permitted: false, retry_allowed: false } };
        }
        if (!state.consumedSha256 && !(reconcileOnly && c.attemptId)) throw new Error('[X_NATIVE_PHASE_MISMATCH]');
        if (attempts.length !== 1 || attempts[0].idempotency_key !== state.context.idempotencyKey
            || attempts[0].channel_id !== c.channelId) throw new Error('[X_NATIVE_ATTEMPT_MISMATCH]');
        const attempt = attempts[0];
        if (attempt.status === 'delivered') {
            const [fact, confirmation] = await Promise.all([
                tx.publicationFact.findUnique({ where: { content_item_id: c.taskId } }),
                tx.workflowEvent.findFirst({ where: { project_id: c.projectId, content_item_id: c.taskId,
                    work_item_id: c.workItemId, actor_id: c.actorId, idempotency_key: state.context.idempotencyKey,
                    command: { in: ['ba_confirm_browser_submission', 'ba_reconcile_browser_submission'] } } })
            ]);
            const proof = object(confirmation?.after_state);
            const consumed = await tx.workflowEvent.findMany({ where: { project_id: c.projectId, content_item_id: c.taskId,
                work_item_id: c.workItemId, actor_id: c.actorId, command: 'x_native_consume_receipt' } });
            const signedEvidence = consumed.some(event => object(event.after_state).attempt_id === attempt.id
                && `sha256:${String(object(event.after_state).receipt_sha256)}` === fact?.evidence_ref);
            if (!fact || fact.project_id !== c.projectId || fact.channel_id !== c.channelId || fact.outcome !== 'published'
                || !fact.published_at || fact.provider_object_id !== proof.provider_object_id || fact.public_url !== proof.public_url
                || fact.published_at.toISOString() !== attempt.actual_published_at?.toISOString()
                || proof.attempt_id !== attempt.id || !signedEvidence || !/^sha256:[a-f0-9]{64}$/.test(fact.evidence_ref || '')) {
                throw new Error('[X_NATIVE_CONFIRMED_FACT_MISMATCH]');
            }
            return { published: { mode: 'published', replayed: true, fact_id: fact.id, public_url: fact.public_url,
                provider_object_id: fact.provider_object_id, published_at: fact.published_at.toISOString(),
                submission_permitted: false, retry_allowed: false } };
        }
        if (attempt.status !== 'pending') throw new Error('[X_NATIVE_RECONCILE_ONLY]');
        const context = await restoredNativeContext(tx, state);
        const work = await tx.workItem.findFirst({ where: { id: c.workItemId, project_id: c.projectId, content_item_id: c.taskId } });
        const historical = !work?.lease_expires_at || work.lease_expires_at.getTime() <= Date.now() || Boolean(attempt.error_message);
        const phase: NativeChallenge['phase'] = historical || reconcileOnly ? 'reconcile'
            : c.phase === 'start' ? 'permit' : c.phase === 'permit' ? 'result' : 'reconcile';
        const { task } = await nativeBoundary(tx, context, deps, historical || phase === 'reconcile');
        return { context, phase, attemptId: attempt.id, acceptedText: task.draft_text };
    }, nativeSerial);
    if ('published' in next) return next.published;
    if ('prestart' in next) return next.prestart;
    const issued = await issueNativeChallenge({ context: next.context, installationId: request.installationId, bundleSha256: request.bundleSha256,
        phase: next.phase, attemptId: next.attemptId }, deps);
    return { ...issued, context: safeNativeContext(next.context), accepted_text: next.acceptedText };
}
