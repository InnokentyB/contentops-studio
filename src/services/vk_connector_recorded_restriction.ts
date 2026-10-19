import { z } from 'zod';
const record = z.object({ platform: z.literal('vk'), ownerId: z.string().regex(/^-[1-9]\d*$/),
    operation: z.enum(['publication', 'search']), observedAt: z.iso.datetime(), basis: z.string().min(1).max(1000) }).strict();
export type VkConnectorRecordedRestriction = z.infer<typeof record>;
/** Only scoped owning-system/audit records are evaluated. No match is not permission to execute. */
export function getVkConnectorRecordedRestriction(binding: { communityId: number }, restrictions: unknown,
    operation: 'publication' | 'search' = 'publication'): VkConnectorRecordedRestriction | null {
    const records = z.array(record).max(200).safeParse(restrictions);
    if (!records.success || !Number.isSafeInteger(binding.communityId) || binding.communityId >= 0)
        throw new Error('[VK_RECORDED_RESTRICTION_INPUT_INVALID]');
    return records.data.find(item => item.ownerId === String(binding.communityId) && item.operation === operation) ?? null;
}
