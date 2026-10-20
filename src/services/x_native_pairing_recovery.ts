import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { browserRequestSchema, checkedBrowserContext, hash, object, snapshotHash, noBrowserDelivery,
    type BrowserDb, type BrowserDependencies } from './browser_publication_contract';
import { nativePublicKeySchema, nativeBundleSchema } from './x_native_receipt';
import { pairingStoredSchema, pairingKey, nativePairingChallengeSchema, verifiedPairing,
    pairingEnrollmentWindowMs } from './x_native_pairing_contract';

export const pairingRecoverySchema = z.object({ phase: z.enum(['preview', 'authorize', 'apply', 'revoke']),
    predecessorNonce: z.string().regex(/^[a-f0-9]{64}$/), approvalReference: z.string().trim().min(10).max(500),
    grantId: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().superRefine((r, ctx) => {
    if (((r.phase === 'apply' || r.phase === 'revoke') && !r.grantId) || (r.phase === 'authorize' && r.grantId)) {
        ctx.addIssue({ code: 'custom', message: 'Apply/revoke requires grantId; authorize forbids it' });
    }
});
const inputSchema = browserRequestSchema.safeExtend({ publicKey: nativePublicKeySchema,
    installationId: z.string().regex(/^[a-f0-9]{64}$/), bundleSha256: nativeBundleSchema,
    extensionId: z.string().regex(/^[a-p]{32}$/), recovery: pairingRecoverySchema });
const grantPayloadSchema = z.object({ grantId: z.string().regex(/^[a-f0-9]{64}$/), bindingSha256: z.string().regex(/^[a-f0-9]{64}$/),
    predecessorSha256: z.string().regex(/^[a-f0-9]{64}$/), issuedAt: z.string().datetime(), expiresAt: z.string().datetime() }).strict();
const grantSchema = z.object({ payload: grantPayloadSchema, consumed: z.boolean(), revoked: z.boolean() }).strict();
/** Same owner command, separate explicit grant and atomic recovery. Ordinary issue counters are never reset. */
export async function recoverPairing(tx: BrowserDb, input: unknown, deps: BrowserDependencies): Promise<Record<string, unknown>> {
    const a = inputSchema.parse(input), r = a.recovery, now = Date.now(), predecessorHash = hash(r.predecessorNonce);
    const context = browserRequestSchema.parse(Object.fromEntries(Object.entries(a).filter(([name]) =>
        !['publicKey', 'installationId', 'extensionId', 'bundleSha256', 'recovery'].includes(name))));
    return recoverChecked(tx, a, context, deps, now, predecessorHash);
}
async function recoverChecked(tx: BrowserDb, a: z.infer<typeof inputSchema>, context: z.infer<typeof browserRequestSchema>,
    deps: BrowserDependencies, now: number, predecessorHash: string): Promise<Record<string, unknown>> {
    const r = a.recovery, grantKey = `x_native:pairing-recovery:v1:${a.taskId}`;
    const row = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId, key: pairingKey(r.predecessorNonce) } } });
    if (!row) throw new Error('[X_NATIVE_PAIRING_REQUIRED]');
    const state = pairingStoredSchema.parse(JSON.parse(row.value));
    await verifiedPairing(tx, state);
    if (state.recoveryRoot || now < Date.parse(state.challenge.expiresAt)) throw new Error('[X_NATIVE_RECOVERY_INELIGIBLE]');
    if (state.context.projectId !== a.projectId || state.context.taskId !== a.taskId || state.context.actorId !== a.actorId
        || state.challenge.installationId !== a.installationId || state.challenge.bundleSha256 !== a.bundleSha256
        || state.challenge.extensionId !== a.extensionId || !isDeepStrictEqual(state.publicKey, a.publicKey)
        || !isDeepStrictEqual({ ...state.context.snapshot, manifestChecksum: a.snapshot.manifestChecksum }, a.snapshot)) {
        throw new Error('[X_NATIVE_RECOVERY_BINDING_MISMATCH]');
    }
    await checkedBrowserContext(tx, context, deps); await noBrowserDelivery(tx, context);
    if ((await tx.contentItem.findFirst({ where: { id: a.taskId, project_id: a.projectId }, include: { publication_fact: true } }))?.publication_fact) {
        throw new Error('[BROWSER_RECONCILIATION_REQUIRED]');
    }
    const installationScope = `${a.snapshot.channelId}:${a.installationId}`;
    if (await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId,
        key: `x_native:installation:v1:${installationScope}` } } }) || await tx.workflowEvent.findFirst({ where: {
        project_id: a.projectId, idempotency_key: installationScope, command: 'x_native_revoke_installation' } })) {
        throw new Error('[X_NATIVE_RECOVERY_INSTALLATION_EXISTS]');
    }
    if (await tx.workflowEvent.count({ where: { project_id: a.projectId, content_item_id: a.taskId,
        command: 'x_native_recover_pairing' } }) > 0) throw new Error('[X_NATIVE_RECOVERY_LIMIT]');
    const bindingSha256 = hash(JSON.stringify({ context, predecessorHash, publicKey: a.publicKey,
        installationId: a.installationId, extensionId: a.extensionId, bundleSha256: a.bundleSha256, approvalReference: r.approvalReference }));
    const grantRow = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId, key: grantKey } } });
    let grant = grantRow ? grantSchema.parse(JSON.parse(grantRow.value)) : null;
    if (grant) {
        const audit = await tx.workflowEvent.findFirst({ where: { project_id: a.projectId, content_item_id: a.taskId,
            actor_id: a.actorId, command: 'x_native_authorize_pairing_recovery', idempotency_key: grant.payload.grantId } });
        const issued = Date.parse(grant.payload.issuedAt), expires = Date.parse(grant.payload.expiresAt);
        if (grant.payload.bindingSha256 !== bindingSha256 || grant.payload.predecessorSha256 !== predecessorHash
            || object(audit?.after_state).grant_sha256 !== hash(JSON.stringify(grant.payload)) || grant.consumed || grant.revoked
            || await tx.workflowEvent.findFirst({ where: { project_id: a.projectId, content_item_id: a.taskId,
                command: 'x_native_revoke_pairing_recovery', idempotency_key: grant.payload.grantId } })) throw new Error('[X_NATIVE_RECOVERY_GRANT_INVALID]');
        if (now < issued || now >= expires || expires <= issued || expires - issued > 900000
            || expires > Date.parse(state.challenge.issuedAt) + pairingEnrollmentWindowMs) throw new Error('[X_NATIVE_RECOVERY_GRANT_EXPIRED]');
        if (r.grantId && r.grantId !== grant.payload.grantId) throw new Error('[X_NATIVE_RECOVERY_GRANT_INVALID]');
    }
    if (r.phase === 'preview') {
        if (r.grantId && !grant) throw new Error('[X_NATIVE_RECOVERY_GRANT_REQUIRED]');
        if (!r.grantId) return { mode: 'pairing_recovery_authorization_preview', apply_ready: false,
            code: 'X_NATIVE_RECOVERY_GRANT_REQUIRED', next_step: grant ? 'Preview with the exact authorized grantId' : 'Obtain explicit owner authorization',
            publication_authorized: false };
        return { mode: 'pairing_recovery_preview', apply_ready: true, publication_authorized: false };
    }
    if (r.phase === 'authorize') {
        if (!grant) {
            const payload = grantPayloadSchema.parse({ grantId: randomBytes(32).toString('hex'), bindingSha256,
                predecessorSha256: predecessorHash, issuedAt: new Date(now).toISOString(),
                expiresAt: new Date(Math.min(now + 900000, Date.parse(state.challenge.issuedAt) + pairingEnrollmentWindowMs)).toISOString() });
            grant = { payload, consumed: false, revoked: false };
            await tx.projectSettings.create({ data: { project_id: a.projectId, key: grantKey, value: JSON.stringify(grant) } });
            await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, actor_id: a.actorId,
                command: 'x_native_authorize_pairing_recovery', idempotency_key: payload.grantId,
                after_state: { grant_sha256: hash(JSON.stringify(payload)), predecessor_nonce_sha256: predecessorHash,
                    snapshot_sha256: snapshotHash(a.snapshot), approval_reference: r.approvalReference, publication_authorized: false } } });
        }
        return { mode: 'pairing_recovery_authorized', grantId: grant.payload.grantId, expiresAt: grant.payload.expiresAt, publication_authorized: false };
    }
    if (!grantRow || !grant) throw new Error('[X_NATIVE_RECOVERY_GRANT_REQUIRED]');
    if (r.phase === 'revoke') {
        if ((await tx.projectSettings.updateMany({ where: { id: grantRow.id, value: grantRow.value },
            data: { value: JSON.stringify({ ...grant, revoked: true }) } })).count !== 1) throw new Error('[X_NATIVE_RECOVERY_GRANT_INVALID]');
        await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, actor_id: a.actorId,
            command: 'x_native_revoke_pairing_recovery', idempotency_key: grant.payload.grantId, after_state: { publication_authorized: false } } });
        return { mode: 'pairing_recovery_revoked', publication_authorized: false };
    }
    if ((await tx.projectSettings.updateMany({ where: { id: grantRow.id, value: grantRow.value },
        data: { value: JSON.stringify({ ...grant, consumed: true }) } })).count !== 1
        || (await tx.projectSettings.updateMany({ where: { id: row.id, value: row.value }, data: { value: row.value } })).count !== 1) {
        throw new Error('[X_NATIVE_RECOVERY_GRANT_INVALID]');
    }
    const s = a.snapshot;
    const challenge = nativePairingChallengeSchema.parse({ ...state.challenge, manifest: s.manifestChecksum,
        nonce: randomBytes(32).toString('hex'), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString() });
    const successor = pairingStoredSchema.parse({ challenge, context, publicKey: a.publicKey, verifiedSha256: null,
        consumed: false, recoveryRoot: predecessorHash });
    await tx.projectSettings.create({ data: { project_id: a.projectId, key: pairingKey(challenge.nonce), value: JSON.stringify(successor) } });
    await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, actor_id: a.actorId,
        command: 'x_native_recover_pairing', idempotency_key: predecessorHash, after_state: {
            grant_sha256: hash(JSON.stringify(grant.payload)), successor_nonce_sha256: hash(challenge.nonce),
            challenge_sha256: hash(JSON.stringify(challenge)), snapshot_sha256: snapshotHash(s), publication_authorized: false } } });
    return { mode: 'pairing_challenge', challenge, publication_authorized: false };
}
