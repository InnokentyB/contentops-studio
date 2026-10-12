import { z } from 'zod';

/** Optional versioned proof accompanying the hardened browser worker's post confirmation. */
export interface VkPostConfirmationFields {
    postBaselineCapturedAt?: string;
    postBaselineObjectIds?: string[];
    postSubmissionStartedAt?: string;
}
const schema = z.object({
    providerTimestampSource: z.literal('provider'),
    postBaselineCapturedAt: z.string().datetime({ offset: true }),
    postBaselineObjectIds: z.array(z.string().regex(/^-[1-9]\d*_[1-9]\d*$/)).max(100),
    postSubmissionStartedAt: z.string().datetime({ offset: true }),
    readbackObservedAt: z.string().datetime({ offset: true }),
    publishedAt: z.string().datetime({ offset: true }),
    providerObjectId: z.string().regex(/^-[1-9]\d*_[1-9]\d*$/)
});

/** Validate new-post freshness without substituting observed time for provider time. */
export function validateVkPostConfirmation(input: unknown, ownerId: string, now: Date): void {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new Error('[VK_POST_PROOF_INVALID]');
    const proof = parsed.data;
    const baseline = Date.parse(proof.postBaselineCapturedAt);
    const started = Date.parse(proof.postSubmissionStartedAt);
    const observed = Date.parse(proof.readbackObservedAt);
    const published = Date.parse(proof.publishedAt);
    if (!/^-[1-9]\d*$/.test(ownerId)
        || !proof.providerObjectId.startsWith(`${ownerId}_`)
        || proof.postBaselineObjectIds.some(id => !id.startsWith(`${ownerId}_`))
        || new Set(proof.postBaselineObjectIds).size !== proof.postBaselineObjectIds.length
        || proof.postBaselineObjectIds.includes(proof.providerObjectId)
        || baseline > started || started - baseline > 300_000
        || observed < started || observed - started > 600_000
        || published < Math.floor(started / 1000) * 1000
        || published > observed + 30_000 || observed > now.getTime() + 30_000
        || !Number.isFinite(now.getTime())) throw new Error('[VK_POST_PROOF_INVALID]');
}
