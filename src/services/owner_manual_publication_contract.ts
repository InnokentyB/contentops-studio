import { createHash } from 'node:crypto';
import { z } from 'zod';
export const OWNER_MANUAL_EVENT = 'owner_manual_publication.confirmed';
export const OWNER_MANUAL_EVIDENCE_PREFIX = 'owner-manual:v1:';
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const ownerManualPreviewSchema = z.object({ projectId: z.number().int().positive(), taskId: z.number().int().positive(), publicUrl: z.string().max(2048), publishedAt: z.string().max(80), timeBasis: z.literal('OWNER_CONFIRMED_MESSAGE_TIME'), ownerConfirmationReference: z.string().trim().min(10).max(2048), publishedRevision: z.object({ revision: z.number().int().positive(), bodySha256: sha }).strict().optional() }).strict();
export const ownerManualCommitSchema = ownerManualPreviewSchema.extend({ previewHash: sha, expectedManifestChecksum: z.string().min(1).max(200), expectedFactSha256: sha.nullable(), idempotencyKey: z.string().min(1).max(500), correctionReason: z.string().trim().min(10).max(2048).optional() }).strict();
export type OwnerManualInput = z.infer<typeof ownerManualPreviewSchema>;
export type OwnerManualCommit = z.infer<typeof ownerManualCommitSchema>;
export type OwnerManualIdentity = {
    provider: 'vk' | 'dzen';
    object_id: string;
    public_url: string;
    account_id: string | null;
    account_linkage: 'locally_validated' | 'owner_attested';
};
export type OwnerManualProvenance = {
    origin: 'owner_attested_v1';
    time_basis: 'OWNER_CONFIRMED_MESSAGE_TIME';
    published_at_original: string;
    published_at_canonical: string;
    published_at_precision: 'milliseconds';
    revision_binding: 'external_object_only' | 'retained_revision';
    published_revision: number | null;
    published_revision_body_sha256: string | null;
    owner_confirmation_reference: string;
    owner_actor_id: string;
};
export function ownerManualObject(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function canonical(value: unknown): unknown {
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.map(canonical);
    if (value !== null && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
}
export function ownerManualDigest(value: unknown): string { return createHash('sha256').update((JSON.stringify(canonical(value)) ?? 'null')).digest('hex'); }
const messages: Record<string, [
    string,
    string
]> = {
    OWNER_REQUIRED: ['Only the authenticated current non-demo project Owner can confirm this publication.', 'Reconnect with the project Owner profile; caller actor fields and confirmation references cannot grant authority.'],
    INPUT_INVALID: ['The manual confirmation packet is invalid or contains unsupported fields.', 'Provide one supported task, public permalink, offset-bearing publication time and explicit Owner confirmation reference.'],
    URL_INVALID: ['The permalink is not a canonical supported public object URL.', 'Use the HTTPS VK wall post or Dzen article permalink without credentials, query, fragment, editor or redirect links.'],
    CHANNEL_MISMATCH: ['The external object does not match this task channel or configured account.', 'Inspect the intended tenant-owned task and channel; correct the selected object without changing publication authority.'],
    TIME_INVALID: ['The publication time is missing, ambiguous, malformed or in the future.', 'Supply the original offset-bearing ISO time explicitly confirmed by the Owner. Do not substitute a provider timestamp or local time.'],
    REFERENCE_INVALID: ['The confirmation reference contains credential-like or unsafe material.', 'Use a bounded plain Owner confirmation reference; never paste tokens, cookies, authorization headers or signed URLs.'],
    REVISION_UNVERIFIED: ['The claimed published revision has no supported retained immutable proof.', 'Omit the revision to record external-object-only accounting. Retained revision verification is not supported by this command; do not infer the published edition from the current draft.'],
    STALE_PREVIEW: ['The task, fact, manifest or preserved custody changed after preview.', 'Read the current task and history and obtain a fresh Owner preview before confirming. Never resend or change an uncertain attempt.'],
    OBJECT_CONFLICT: ['This external object is already bound to another task.', 'Inspect its existing canonical fact with the Owner; do not reassign it through another task.'],
    IDEMPOTENCY_CONFLICT: ['This confirmation key belongs to a different packet or later corrected fact.', 'Read its retained confirmation audit and the current fact; do not repeat an altered request or replace the key to bypass a conflict.'],
    CORRECTION_REQUIRED: ['An existing different fact requires exact expected state and an Owner correction reason.', 'Preview the current fact and provenance, supply its digest and explain the intended correction. Preserve prior audit history.'],
    UNAVAILABLE: ['The accounting transaction could not complete safely.', 'Read back the existing fact and confirmation key before any further action; an interrupted result never authorizes a provider send.']
};
export class OwnerManualPublicationError extends Error {
    readonly code: string;
    readonly action: string;
    constructor(kind: keyof typeof messages) { const entry = messages[kind] || messages.UNAVAILABLE; super(entry[0]); this.code = `MANUAL_PUBLICATION_${kind}`; this.action = entry[1]; }
}
export function ownerManualError(kind: keyof typeof messages): OwnerManualPublicationError { return new OwnerManualPublicationError(kind); }
export function ownerManualSafeFailure(error: unknown) { const value = error instanceof OwnerManualPublicationError ? error : ownerManualError('UNAVAILABLE'); return { code: value.code, message: value.message, reasons: [{ code: value.code, message: value.message, action: value.action }], action: value.action, retry_allowed: false }; }
