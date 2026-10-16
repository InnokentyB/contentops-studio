import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Owner-approved exact package. Media object and accepted-caption bytes are immutable. */
export const TG1103 = Object.freeze({ project: 10, task: 1103, channel: 109, revision: 2,
    oldReview: 1756, asset: 142, oldDecision: 285, sourceRevision: 1,
    bodySha: 'b703e2b19c67ce62c870dc7998bddcfda2834858aa6b8b572d3d369595ee9e2a',
    assetSha: '23a3dc6208457cb78de4a8e92ee995a67d682ecec9cec703cb38ad53b5730b43',
    bytes: 4022731, date: '2026-10-15T07:05:00.000Z',
    manifest: 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7',
    releaseCommand: 'ba_release_telegram_video_task1103',
    publishCommand: 'ba_publish_telegram_video_task1103', username: 'analystcraft' });

/** Secret-free content fingerprint used in release, claim and finalization fences. */
export const videoHash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
/** Narrow arbitrary persisted JSON before reading operator metadata. */
export function videoRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
/** Exact owner-only preview/apply scope; no caller can broaden task, media or revision. */
export const video1103Scope = z.object({ projectId: z.literal(10), taskId: z.literal(1103),
    actorId: z.string().regex(/^user:[1-9]\d*$/), expectedBodySha256: z.literal(TG1103.bodySha),
    expectedAssetSha256: z.literal(TG1103.assetSha), reason: z.string().min(10).max(1000),
    idempotencyKey: z.string().min(1).max(160), apply: z.boolean().default(false) }).strict();
