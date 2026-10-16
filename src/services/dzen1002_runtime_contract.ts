import { createHash } from 'crypto';
import { z } from 'zod';
import { DZEN1002_MANIFEST } from './dzen_task1002_manifest';

/** Fixed owner-approved package; never derived from caller or provider responses. */
export const DZEN1002_RUNTIME = {
    projectId: 10, taskId: 1002, channelId: 116, revision: 3, decisionId: 300,
    decisionVersion: 2, selectedAssetId: 151, releaseId: 3126,
    bodySha256: '570bf2c102911ae4fc678ad453bb0289e48cf4e6161e874d6e39811e2527e9bb',
    assetSha256: '003dae64a6087ee456bb9af583b78955c6a6738de294ca7cf75c83b151d06a12',
    schedule: '2026-10-13T11:30:00.000Z', placement: 'article_cover',
    manifest: DZEN1002_MANIFEST, providerChannelId: '6a8029aba055ec36033bf81c'
} as const;
export interface Dzen1002Args {
    projectId: 10; taskId: 1002; actorId: string; expectedManifestChecksum: string;
    idempotencyKey: string; dryRun?: boolean;
}
export interface Dzen1002Package {
    projectId: number; taskId: number; channelId: number; revision: number;
    decisionId: number; decisionVersion: number; selectedAssetId: number;
    bodySha256: string; assetSha256: string; schedule: string; manifest: string;
    releaseId: number; accountId: string; body: string; title: string; assetUrl: string; digest: string;
}
export interface Dzen1002Claim { attemptId: number; key: string; package: Dzen1002Package }
export interface Dzen1002Receipt {
    schemaVersion: 'dzen1002-native-v1'; attemptId: number; key: string; packageDigest: string;
    accountId: string; objectId: string; url: string; publishedAt: string; observedAt: string;
    bodySha256: string; assetSha256: string; title: string;
}
export interface Dzen1002Result {
    mode: 'published' | 'verification_required' | 'dry_run'; task_id: 1002;
    attempt_id?: number; retry_allowed: false; published_link?: string; external_id?: string;
}
/** Stored JSON is parsed into a fixed-order allowlist before digest checks. */
export const dzen1002PackageSchema = z.object({
    projectId: z.literal(10), taskId: z.literal(1002), channelId: z.literal(116), revision: z.literal(3),
    decisionId: z.literal(300), decisionVersion: z.literal(2), selectedAssetId: z.literal(151),
    bodySha256: z.literal(DZEN1002_RUNTIME.bodySha256), assetSha256: z.literal(DZEN1002_RUNTIME.assetSha256),
    schedule: z.literal(DZEN1002_RUNTIME.schedule), manifest: z.literal(DZEN1002_RUNTIME.manifest),
    releaseId: z.literal(3126), accountId: z.literal(DZEN1002_RUNTIME.providerChannelId),
    body: z.string().min(1), title: z.string().min(1), assetUrl: z.string().url().startsWith('https://'),
    digest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export const dzen1002ReceiptSchema = z.object({
    schemaVersion: z.literal('dzen1002-native-v1'), attemptId: z.number().int().positive(),
    key: z.string().min(1).max(200), packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
    accountId: z.literal(DZEN1002_RUNTIME.providerChannelId), objectId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    url: z.string().url(), publishedAt: z.string().datetime(), observedAt: z.string().datetime(),
    bodySha256: z.literal(DZEN1002_RUNTIME.bodySha256), assetSha256: z.literal(DZEN1002_RUNTIME.assetSha256),
    title: z.string().min(1).max(1000)
}).strict();
export function dzen1002Hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function dzen1002Object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** No receipt can carry arbitrary provider payload or secret-bearing extra fields. */
export function validateDzen1002Receipt(value: unknown, claim: Dzen1002Claim, now: Date): Dzen1002Receipt {
    const r = dzen1002ReceiptSchema.parse(value);
    if (r.attemptId !== claim.attemptId || r.key !== claim.key || r.packageDigest !== claim.package.digest
        || r.accountId !== claim.package.accountId || r.title !== claim.package.title
        || r.url !== `https://dzen.ru/a/${r.objectId}` || r.objectId === 'asvdioZFzXeQEO5O'
        || Date.parse(r.publishedAt) < Date.parse(claim.package.schedule)
        || Date.parse(r.publishedAt) > Date.parse(r.observedAt) || Date.parse(r.observedAt) > now.getTime()) {
        throw new Error('[DZEN1002_RECEIPT_MISMATCH]');
    }
    return r;
}
