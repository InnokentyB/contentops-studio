import { z } from 'zod';

/** Additional evidence required only for a Clip, never inferred from a video/wall URL. */
export type VkClipConfirmationFields = {
    providerKind?: string; providerTimestampSource?: string; clipBaselineCapturedAt?: string;
    clipBaselineObjectIds?: string[]; clipSubmissionStartedAt?: string; readbackObservedAt?: string;
    clipMediaSha256?: string;
};

const proof = z.object({
    providerKind: z.literal('short_video'), providerTimestampSource: z.literal('provider'),
    clipBaselineCapturedAt: z.string().datetime({ offset: true }),
    clipBaselineObjectIds: z.array(z.string().regex(/^clip-[1-9]\d*_[1-9]\d*$/)).max(200),
    clipSubmissionStartedAt: z.string().datetime({ offset: true }),
    readbackObservedAt: z.string().datetime({ offset: true }), clipMediaSha256: z.string().regex(/^[a-f0-9]{64}$/)
});
type IdentityInput = VkClipConfirmationFields & { publicUrl: string | null; providerObjectId: string;
    publishedAt: string; evidenceSha256: string; imageSha256: string | null };
export type VkClipIdentity = { publicUrl: string; publishedAt: string; placement: 'clip' };

/** Fail closed on stale, foreign, ordinary-video, local-clock or missing-media evidence. */
export function validateVkClipConfirmation(args: IdentityInput, ownerId: string, now: Date,
    attemptCreatedAt?: Date | null): VkClipIdentity {
    const parsed = proof.safeParse(args);
    if (!parsed.success) throw new Error('[VK_CLIP_EVIDENCE_REQUIRED]');
    let url: URL;
    try { url = new URL(args.publicUrl || ''); }
    catch { throw new Error('[VK_CLIP_PROVIDER_IDENTITY_INVALID]'); }
    const match = /^\/clip(-[1-9]\d*)_([1-9]\d*)$/.exec(url.pathname);
    if (!/^https:\/\/(?:www\.)?vk\.(?:com|ru)\/clip-[1-9]\d*_[1-9]\d*$/.test(args.publicUrl || '')
        || !match || match[1] !== ownerId || !/^-[1-9]\d*$/.test(ownerId)
        || args.providerObjectId !== `clip${match[1]}_${match[2]}`
        || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
        || !['vk.com', 'www.vk.com', 'vk.ru', 'www.vk.ru'].includes(url.hostname.toLowerCase())
        || !/^[a-f0-9]{64}$/.test(args.evidenceSha256)) {
        throw new Error('[VK_CLIP_PROVIDER_IDENTITY_INVALID]');
    }
    const data = parsed.data;
    const baseline = Date.parse(data.clipBaselineCapturedAt), started = Date.parse(data.clipSubmissionStartedAt);
    const observed = Date.parse(data.readbackObservedAt), published = Date.parse(args.publishedAt);
    const created = attemptCreatedAt?.getTime();
    if (![baseline, started, observed, published, now.getTime()].every(Number.isFinite)
        || baseline > started || started - baseline > 300_000 || observed < started
        || observed - started > 600_000 || observed > now.getTime() + 30_000
        || published < started - 10_000 || published > observed + 30_000
        || (created !== undefined && (!Number.isFinite(created) || started < created - 10_000
            || started - created > 60_000))) throw new Error('[VK_CLIP_FRESHNESS_INVALID]');
    if (data.clipBaselineObjectIds.includes(args.providerObjectId)
        || new Set(data.clipBaselineObjectIds).size !== data.clipBaselineObjectIds.length
        || data.clipBaselineObjectIds.some(id => !id.startsWith(`clip${ownerId}_`))) {
        throw new Error('[VK_CLIP_NEW_OBJECT_UNCONFIRMED]');
    }
    if (!args.imageSha256 || data.clipMediaSha256 !== args.imageSha256) {
        throw new Error('[VK_CLIP_MEDIA_MISMATCH]');
    }
    return { publicUrl: `https://vk.com/${args.providerObjectId}`, publishedAt: new Date(published).toISOString(), placement: 'clip' };
}
