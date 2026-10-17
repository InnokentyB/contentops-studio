import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { browserDefaults, hash, type BrowserDependencies } from './browser_publication_contract';
import { browserBoundarySchema } from './browser_publication_guard';
import { nativeChallengeSchema, nativeReadSchema, verifyNativeRead, nativeBundleSchema, assertNativeBundle } from './x_native_receipt';
import { installedNative, nativeSerial } from './x_native_registry';
import { assertNativeExtensionOrigin } from './x_native_origin';
import { nativeBoundary, nativeAttempts, nativeChallengeKey, nativePhaseKey, nativeStoredSchema,
    safeNativeContext, loadNativeState, restoredNativeContext } from './x_native_state';

export const nativeIssueSchema = z.object({ context: browserBoundarySchema,
    installationId: z.string().regex(/^[a-f0-9]{64}$/), bundleSha256: nativeBundleSchema, phase: z.enum(['start', 'permit', 'result', 'reconcile']),
    attemptId: z.number().int().positive().nullable() }).strict();
/** Issuance carries no click authority. Mutable package/lease/registration gates run again at consumption. */
export async function issueNativeChallenge(input: unknown, deps: BrowserDependencies = browserDefaults) {
    const { context: a, installationId, bundleSha256, phase, attemptId } = nativeIssueSchema.parse(input);
    return deps.db.$transaction(async tx => {
        const { work, proof } = await nativeBoundary(tx, a, deps, phase === 'reconcile');
        const registration = await installedNative(tx, { projectId: a.projectId, channelId: a.snapshot.channelId,
            actorId: a.actorId, installationId });
        assertNativeBundle(bundleSha256, registration.bundleSha256);
        await nativeAttempts(tx, a, phase, attemptId);
        if (await tx.workflowEvent.count({ where: { project_id: a.projectId, content_item_id: a.taskId,
            command: 'x_native_issue_challenge' } }) >= 12) throw new Error('[X_NATIVE_RECONCILIATION_LIMIT]');
        const now = Date.now(), s = a.snapshot;
        const expires = phase === 'reconcile' ? now + 30000
            : Math.min(now + (phase === 'permit' ? 15000 : 30000), work.lease_expires_at!.getTime());
        const challenge = nativeChallengeSchema.parse({ version: 1, projectId: a.projectId, taskId: a.taskId,
            channelId: s.channelId, revision: s.contentRevision, bodySha256: s.bodySha256, manifest: s.manifestChecksum,
            account: s.identity.accountRef, profileUrl: s.identity.profileUrl, scheduleAt: s.scheduleAt,
            installationId: registration.installationId, bundleSha256: registration.bundleSha256, actorId: a.actorId, workItemId: work.id, attemptId, phase,
            nonce: randomBytes(32).toString('hex'), issuedAt: new Date(now).toISOString(),
            expiresAt: new Date(expires).toISOString(),
            leaseSha256: hash(a.leaseToken), releaseKeySha256: hash(String(proof.release_key)), sendKeySha256: hash(a.idempotencyKey) });
        const phaseKey = nativePhaseKey(challenge);
        const prior = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId, key: phaseKey } } });
        if (prior && phase !== 'reconcile') {
            const previous = await tx.projectSettings.findUnique({ where: { project_id_key: {
                project_id: a.projectId, key: `x_native:challenge:v1:${prior.value}` } } });
            if (!previous) throw new Error('[X_NATIVE_CHALLENGE_REQUIRED]');
            const old = nativeStoredSchema.parse(JSON.parse(previous.value));
            // Only unused START can be refreshed before ANY attempt. Never renew a final click permit.
            if (phase !== 'start' || old.consumedSha256 !== null || Date.parse(old.challenge.expiresAt) > now) {
                throw new Error('[X_NATIVE_RECONCILE_ONLY]');
            }
        }
        const context = safeNativeContext(a);
        await tx.projectSettings.create({ data: { project_id: a.projectId, key: nativeChallengeKey(challenge.nonce),
            value: JSON.stringify({ challenge, context, consumedSha256: null }) } });
        await tx.projectSettings.upsert({ where: { project_id_key: { project_id: a.projectId, key: phaseKey } },
            create: { project_id: a.projectId, key: phaseKey, value: hash(challenge.nonce) }, update: { value: hash(challenge.nonce) } });
        await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, work_item_id: work.id,
            actor_id: a.actorId, command: 'x_native_issue_challenge', idempotency_key: hash(challenge.nonce),
            after_state: { phase, installation_id: registration.installationId, attempt_id: attemptId,
                bundle_sha256: registration.bundleSha256,
                challenge_sha256: hash(JSON.stringify(challenge)), context_sha256: hash(JSON.stringify(context)),
                nonce_sha256: hash(challenge.nonce), expires_at: challenge.expiresAt, submission_permitted: false } } });
        return { challenge, submission_permitted: false };
    }, nativeSerial);
}
/** Signed read delegate has no claim, attempt, permit, release, or broad owner token. */
export async function readNativeChallenge(input: unknown, deps: BrowserDependencies = browserDefaults, origin?: string) {
    const request = nativeReadSchema.parse(input);
    return deps.db.$transaction(async tx => {
        const { state } = await loadNativeState(tx, request.projectId, request.nonce), c = state.challenge;
        const registration = await installedNative(tx, { projectId: c.projectId, channelId: c.channelId,
            actorId: c.actorId, installationId: c.installationId });
        assertNativeExtensionOrigin(origin, registration.extensionId);
        assertNativeBundle(c.bundleSha256, registration.bundleSha256);
        verifyNativeRead(request, registration.publicKey, Date.now(), 'read', registration.bundleSha256);
        if (request.channelId !== c.channelId || request.installationId !== c.installationId
            || state.consumedSha256 !== null || Date.now() >= Date.parse(c.expiresAt)) throw new Error('[X_NATIVE_CHALLENGE_EXPIRED]');
        const context = await restoredNativeContext(tx, state);
        const { task } = await nativeBoundary(tx, context, deps, c.phase === 'reconcile');
        await nativeAttempts(tx, context, c.phase, c.attemptId);
        return { challenge: c, context: safeNativeContext(context), accepted_text: task.draft_text,
            submission_permitted: false, native_observation_required: true };
    }, nativeSerial);
}
/** Refresh is only a replacement of an unused expired START; it never renews a lease. */
export async function refreshNativeStart(input: unknown, deps: BrowserDependencies = browserDefaults, origin?: string) {
    const request = nativeReadSchema.parse(input);
    const stage = await deps.db.$transaction(async tx => {
        const { state } = await loadNativeState(tx, request.projectId, request.nonce), c = state.challenge;
        const registration = await installedNative(tx, { projectId: c.projectId, channelId: c.channelId,
            actorId: c.actorId, installationId: c.installationId });
        assertNativeExtensionOrigin(origin, registration.extensionId);
        assertNativeBundle(c.bundleSha256, registration.bundleSha256);
        verifyNativeRead(request, registration.publicKey, Date.now(), 'refresh', registration.bundleSha256);
        if (request.channelId !== c.channelId || request.installationId !== c.installationId
            || c.phase !== 'start' || c.attemptId !== null || state.consumedSha256 !== null) throw new Error('[X_NATIVE_RECONCILE_ONLY]');
        const context = await restoredNativeContext(tx, state);
        const { task } = await nativeBoundary(tx, context, deps);
        return { context, acceptedText: task.draft_text };
    }, nativeSerial);
    return { ...await issueNativeChallenge({ context: stage.context, installationId: request.installationId, bundleSha256: request.bundleSha256,
        phase: 'start', attemptId: null }, deps), context: safeNativeContext(stage.context), accepted_text: stage.acceptedText };
}
/** A heartbeat proves only the same installation is alive, never extends an execution window. */
export async function heartbeatNativeExecution(input: unknown, deps: BrowserDependencies = browserDefaults, origin?: string) {
    const request = nativeReadSchema.parse(input);
    return deps.db.$transaction(async tx => {
        const { state } = await loadNativeState(tx, request.projectId, request.nonce), c = state.challenge;
        const registration = await installedNative(tx, { projectId: c.projectId, channelId: c.channelId,
            actorId: c.actorId, installationId: c.installationId });
        assertNativeExtensionOrigin(origin, registration.extensionId);
        assertNativeBundle(c.bundleSha256, registration.bundleSha256);
        verifyNativeRead(request, registration.publicKey, Date.now(), 'heartbeat', registration.bundleSha256);
        if (request.channelId !== c.channelId || request.installationId !== c.installationId) throw new Error('[X_NATIVE_INSTALLATION_INVALID]');
        const context = await restoredNativeContext(tx, state);
        await nativeBoundary(tx, context, deps, c.phase === 'reconcile');
        await nativeAttempts(tx, context, c.phase, c.attemptId);
        return { mode: 'active', submission_permitted: false, lease_renewed: false, observed_at: new Date().toISOString() };
    }, nativeSerial);
}
