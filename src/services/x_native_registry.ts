import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { browserRequestSchema, browserDefaults, checkedBrowserContext, requireBrowserOwner,
    hash, object, type BrowserDb, type BrowserDependencies, type BrowserSnapshot } from './browser_publication_contract';
import { nativePublicKeySchema, nativeKeyFingerprint } from './x_native_receipt';
import { consumeNativePairing } from './x_native_pairing';

export const nativeSerial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
export const nativeScopeSchema = z.object({ projectId: z.number().int().positive(), channelId: z.number().int().positive(),
    installationId: z.string().regex(/^[a-f0-9]{64}$/), actorId: z.string().regex(/^user:[1-9]\d*$/) }).strict();
export type NativeScope = z.infer<typeof nativeScopeSchema>;
export const nativeRegistrationSchema = browserRequestSchema.safeExtend({ publicKey: nativePublicKeySchema,
    installationId: z.string().regex(/^[a-f0-9]{64}$/), extensionId: z.string().regex(/^[a-p]{32}$/),
    uatReference: z.string().trim().min(10).max(500), pairingNonce: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export const nativeInstallationSchema = nativeScopeSchema.extend({ publicKey: nativePublicKeySchema,
    extensionId: z.string().regex(/^[a-p]{32}$/), uatReference: z.string().min(10).max(500), revoked: z.boolean() }).strict();
export type NativeInstallation = z.infer<typeof nativeInstallationSchema>;
const installationKey = (scope: NativeScope) => `x_native:installation:v1:${scope.channelId}:${scope.installationId}`;

export function requireNativeSnapshot(snapshot: BrowserSnapshot): void {
    if (snapshot.identity.platform !== 'x' || snapshot.identity.accountType !== 'personal'
        || snapshot.selectedAssetId !== null || snapshot.assetSha256 !== null
        || !/^@[A-Za-z0-9_]{1,15}$/.test(snapshot.identity.accountRef)
        || snapshot.identity.profileUrl !== `https://x.com/${snapshot.identity.accountRef.slice(1)}`) {
        throw new Error('[X_NATIVE_SNAPSHOT_UNSUPPORTED]');
    }
}
/** Enrollment needs canonical owner context, a signed one-shot pairing and explicit human no-send UAT. */
export async function registerNativeInstallation(input: unknown, deps: BrowserDependencies = browserDefaults) {
    const a = nativeRegistrationSchema.parse(input);
    requireNativeSnapshot(a.snapshot);
    if (nativeKeyFingerprint(a.publicKey) !== a.installationId) throw new Error('[X_NATIVE_INSTALLATION_INVALID]');
    return deps.db.$transaction(async tx => {
        await checkedBrowserContext(tx, a, deps);
        const record = nativeInstallationSchema.parse({ projectId: a.projectId, channelId: a.snapshot.channelId,
            actorId: a.actorId, publicKey: a.publicKey, installationId: a.installationId,
            extensionId: a.extensionId, uatReference: a.uatReference, revoked: false });
        const key = installationKey(record);
        const prior = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId, key } } });
        if (prior) {
            if (hash(prior.value) !== hash(JSON.stringify(record))) throw new Error('[X_NATIVE_INSTALLATION_REBIND_FORBIDDEN]');
            await installedNative(tx, record);
            return { mode: 'registered', replayed: true, publication_authorized: false };
        }
        if (!a.apply) return { mode: 'preview', installation_id: a.installationId, publication_authorized: false };
        const pairingHash = await consumeNativePairing(tx, a, record, deps);
        await tx.projectSettings.create({ data: { project_id: a.projectId, key, value: JSON.stringify(record) } });
        await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId, actor_id: a.actorId,
            command: 'x_native_register_installation', idempotency_key: `${record.channelId}:${record.installationId}`,
            after_state: { installation_id: record.installationId, channel_id: record.channelId,
                registration_sha256: hash(JSON.stringify(record)), pairing_nonce_sha256: pairingHash,
                uat_reference: a.uatReference, publication_authorized: false } } });
        return { mode: 'registered', installation_id: record.installationId, publication_authorized: false };
    }, nativeSerial);
}
/** Mutable settings cannot replace immutable enrollment audit, and revocation is sticky. */
export async function installedNative(tx: BrowserDb, scope: NativeScope): Promise<NativeInstallation> {
    const row = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: scope.projectId, key: installationKey(scope) } } });
    if (!row) throw new Error('[X_NATIVE_INSTALLATION_REQUIRED]');
    const record = nativeInstallationSchema.parse(JSON.parse(row.value));
    if (record.projectId !== scope.projectId || record.channelId !== scope.channelId || record.actorId !== scope.actorId
        || record.installationId !== scope.installationId || record.revoked) throw new Error('[X_NATIVE_INSTALLATION_INVALID]');
    const selector = { project_id: scope.projectId,
        idempotency_key: `${scope.channelId}:${scope.installationId}` };
    const [enrollment, revocation] = await Promise.all([
        tx.workflowEvent.findFirst({ where: { ...selector, actor_id: scope.actorId, command: 'x_native_register_installation' } }),
        tx.workflowEvent.findFirst({ where: { ...selector, command: 'x_native_revoke_installation' } })
    ]);
    if (revocation || object(enrollment?.after_state).registration_sha256 !== hash(JSON.stringify(record))) {
        throw new Error('[X_NATIVE_INSTALLATION_AUDIT_REQUIRED]');
    }
    return record;
}
export async function revokeNativeInstallation(input: unknown, deps: BrowserDependencies = browserDefaults) {
    const a = nativeScopeSchema.extend({ reference: z.string().trim().min(10).max(500) }).parse(input);
    return deps.db.$transaction(async tx => {
        await requireBrowserOwner(tx, a);
        const key = installationKey(a);
        const row = await tx.projectSettings.findUnique({ where: { project_id_key: { project_id: a.projectId, key } } });
        if (!row) throw new Error('[X_NATIVE_INSTALLATION_REQUIRED]');
        const record = nativeInstallationSchema.parse(JSON.parse(row.value));
        if (record.projectId !== a.projectId || record.channelId !== a.channelId || record.installationId !== a.installationId) throw new Error('[OWNER_REQUIRED]');
        if (record.revoked) return { mode: 'revoked', replayed: true, submission_permitted: false };
        await installedNative(tx, { ...a, actorId: record.actorId });
        await tx.projectSettings.update({ where: { id: row.id }, data: { value: JSON.stringify({ ...record, revoked: true }) } });
        await tx.workflowEvent.create({ data: { project_id: a.projectId, actor_id: a.actorId,
            command: 'x_native_revoke_installation', idempotency_key: `${a.channelId}:${a.installationId}`,
            after_state: { installation_id: a.installationId, channel_id: a.channelId,
                reference: a.reference, submission_permitted: false, reconciliation_required: true } } });
        return { mode: 'revoked', submission_permitted: false, reconciliation_required: true };
    }, nativeSerial);
}
