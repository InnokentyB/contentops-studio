import { z } from 'zod';

const id = z.number().int().min(1).max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.string().datetime().length(24);
const actor = z.string().regex(/^user:[1-9]\d{0,9}$/).refine(value => Number(value.slice(5)) <= 2147483647);
export const nativeStateRequestSchema = z.object({ projectId: id, channelId: id, taskId: id,
    candidateInstallationId: hash, actorId: actor }).strict();
export type NativeStateRequest = z.infer<typeof nativeStateRequestSchema>;
export const nativeStateWarningSchema = z.enum(['INVENTORY_OVERFLOW', 'AUDIT_OVERFLOW', 'INVALID_RECORD',
    'AUDIT_INCONSISTENT', 'BINDING_INCONSISTENT', 'CANDIDATE_REVOKED', 'OTHER_ACTIVE_INSTALLATION', 'TASK_DELIVERY_HISTORY']);
export type NativeStateWarning = z.infer<typeof nativeStateWarningSchema>;
export const nativeStateErrorCodeSchema = z.enum(['OWNER_REQUIRED', 'X_NATIVE_PILOT_DISABLED',
    'X_NATIVE_STATE_INVALID_INPUT', 'X_NATIVE_STATE_SCOPE_DENIED', 'X_NATIVE_STATE_BUSY',
    'X_NATIVE_STATE_TIMEOUT', 'X_NATIVE_STATE_RESPONSE_LIMIT']);
type ErrorCode = z.infer<typeof nativeStateErrorCodeSchema>;
export class NativeStateReadError extends Error {
    constructor(readonly code: ErrorCode) { super(`[${code}]`); }
}
export const nativeStateRowSchema = z.object({ installationId: hash,
    extensionId: z.string().regex(/^[a-p]{32}$/).nullable(), bundleSha256: hash.nullable(),
    registeredByCaller: z.boolean().nullable(), effectiveState: z.enum(['active', 'revoked', 'untrusted']),
    auditStatus: z.enum(['verified', 'missing', 'mismatch', 'unknown']),
    registeredAt: time.nullable(), revokedAt: time.nullable(), updatedAt: time.nullable() }).strict();
export type NativeStateRow = z.infer<typeof nativeStateRowSchema>;
export const nativeStateInventorySchema = z.object({ complete: z.boolean(), totalCount: z.number().int().min(0).max(20).nullable(),
    candidateState: z.enum(['absent', 'active', 'revoked', 'untrusted', 'unknown']),
    otherActivePresent: z.boolean().nullable(), rows: z.array(nativeStateRowSchema).max(20) }).strict();
const maybeBoolean = z.boolean().nullable();
export const nativeTaskStateSchema = z.object({ status: z.enum(['known', 'unknown']), attemptPresent: maybeBoolean,
    unresolvedAttemptPresent: maybeBoolean, browserWorkPresent: maybeBoolean, nonterminalBrowserWorkPresent: maybeBoolean,
    nonterminalDispatchJobPresent: maybeBoolean, publicationFactPresent: maybeBoolean, publishedLinkPresent: maybeBoolean,
    currentReleasePresent: maybeBoolean }).strict();
export type NativeTaskState = z.infer<typeof nativeTaskStateSchema>;
export const nativeStateResponseSchema = z.object({ schemaVersion: z.literal(1),
    scope: nativeStateRequestSchema.omit({ actorId: true }), observedAt: time, complete: z.boolean(),
    binding: z.object({ channelActive: z.boolean(), status: z.enum(['consistent', 'inconsistent', 'unbound']) }).strict(),
    installations: nativeStateInventorySchema, taskState: nativeTaskStateSchema,
    warnings: z.array(nativeStateWarningSchema).max(8), effects: z.object({ mutatesState: z.literal(false),
        providerCalled: z.literal(false), submissionPermitted: z.literal(false), registrationAuthorized: z.literal(false) }).strict() }).strict();
export type NativeStateResponse = z.infer<typeof nativeStateResponseSchema>;

/** Redacted, fixed-shape errors only; never serialize provider/SQL/request exceptions. */
export function nativeStateReadError(error: unknown): { code: ErrorCode; mutatesState: false; providerCalled: false } {
    if (error instanceof NativeStateReadError) return { code: error.code, mutatesState: false, providerCalled: false };
    const owner = error instanceof Error && error.message === '[OWNER_REQUIRED]';
    return { code: owner ? 'OWNER_REQUIRED' : 'X_NATIVE_STATE_TIMEOUT', mutatesState: false, providerCalled: false };
}

/** Bound serialized output before strict DTO parsing; no arbitrary extra fields escape. */
export function checkedNativeStateResponse(value: unknown): NativeStateResponse {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 32768) throw new NativeStateReadError('X_NATIVE_STATE_RESPONSE_LIMIT');
    return nativeStateResponseSchema.parse(value);
}
