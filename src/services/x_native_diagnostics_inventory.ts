import { z } from 'zod';
import { hash } from './browser_publication_contract';
import { nativeInstallationSchema } from './x_native_registry';
import { nativeKeyFingerprint } from './x_native_receipt';
import { nativeStateRowSchema, type NativeStateRequest, type NativeStateRow, type NativeStateWarning } from './x_native_diagnostics_contract';

export const nativeSettingReadSchema = z.object({ installationId: z.string(), value: z.string().max(2048).nullable(),
    oversized: z.boolean(), updatedAt: z.date() }).strict();
export const nativeAuditReadSchema = z.object({ installationId: z.string(), actorId: z.string().max(32),
    command: z.enum(['x_native_register_installation', 'x_native_revoke_installation']),
    metadataValid: z.boolean(), registrationHash: z.string().max(64).nullable(), createdAt: z.date() }).strict();
export type NativeInventorySource = { ids: string[]; invalidKey: boolean;
    settings: z.infer<typeof nativeSettingReadSchema>[]; audits: z.infer<typeof nativeAuditReadSchema>[];
    revoked: { installationId: string; revokedAt: Date }[] };

function parsedObject(value: string | null): Record<string, unknown> | null {
    if (value === null) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { return null; } // Invalid bounded persisted data is classified below, never logged.
}

/** Union inventory with exhaustive revocation facts; capped/malformed data never proves absence. */
export function projectNativeInventory(source: NativeInventorySource, request: NativeStateRequest) {
    const warnings = new Set<NativeStateWarning>();
    if (source.invalidKey) warnings.add('INVALID_RECORD');
    if (source.ids.length > 20) warnings.add('INVENTORY_OVERFLOW');
    const auditOverflow = source.audits.length > 80;
    if (auditOverflow) warnings.add('AUDIT_OVERFLOW');
    let complete = !source.invalidKey && source.ids.length <= 20 && !auditOverflow;
    const rows: NativeStateRow[] = source.ids.slice(0, 20).map(installationId => {
        const setting = source.settings.find(row => row.installationId === installationId);
        const raw = parsedObject(setting?.value ?? null);
        const parsed = nativeInstallationSchema.safeParse(raw);
        let valid = parsed.success;
        if (parsed.success) {
            const record = parsed.data;
            try { valid = record.projectId === request.projectId && record.channelId === request.channelId
                && record.installationId === installationId && nativeKeyFingerprint(record.publicKey) === installationId; }
            catch { valid = false; } // Invalid key material is untrusted, not a raw crypto error.
        }
        const record = parsed.success ? parsed.data : null;
        const revoked = source.revoked.find(row => row.installationId === installationId);
        const events = source.audits.slice(0, 80).filter(row => row.installationId === installationId);
        const metadataValid = events.every(row => row.metadataValid);
        const enrollment = events.find(row => row.command === 'x_native_register_installation' && row.actorId === record?.actorId);
        const original = record ? nativeInstallationSchema.parse({ ...record, revoked: false }) : null;
        const audited = valid && metadataValid && original !== null && enrollment?.registrationHash === hash(JSON.stringify(original));
        const effectivelyRevoked = Boolean(revoked) || raw?.revoked === true;
        const active = valid && audited && !auditOverflow && !effectivelyRevoked;
        const auditStatus = auditOverflow ? 'unknown' : !enrollment ? 'missing' : audited ? 'verified' : 'mismatch';
        if (!valid || !metadataValid || setting?.oversized) warnings.add('INVALID_RECORD');
        if (!audited) warnings.add('AUDIT_INCONSISTENT');
        if (!valid || !audited || auditOverflow) complete = false;
        return nativeStateRowSchema.parse({ installationId, extensionId: record?.extensionId ?? null,
            bundleSha256: record?.bundleSha256 ?? null, registeredByCaller: record ? record.actorId === request.actorId : null,
            effectiveState: effectivelyRevoked ? 'revoked' : active ? 'active' : 'untrusted', auditStatus,
            registeredAt: enrollment?.createdAt.toISOString() ?? null, revokedAt: revoked?.revokedAt.toISOString() ?? null,
            updatedAt: setting?.updatedAt.toISOString() ?? null });
    });
    const candidate = rows.find(row => row.installationId === request.candidateInstallationId);
    const other = rows.some(row => row.installationId !== request.candidateInstallationId && row.effectiveState === 'active');
    const candidateState = candidate?.effectiveState === 'revoked' ? 'revoked' : candidate?.effectiveState === 'active' ? 'active'
        : candidate ? auditOverflow ? 'unknown' : 'untrusted' : complete ? 'absent' : 'unknown';
    if (candidateState === 'revoked') warnings.add('CANDIDATE_REVOKED');
    if (other) warnings.add('OTHER_ACTIVE_INSTALLATION');
    return { inventory: { complete, totalCount: complete ? rows.length : null, candidateState,
        otherActivePresent: other ? true : complete ? false : null, rows }, warnings: [...warnings] };
}
