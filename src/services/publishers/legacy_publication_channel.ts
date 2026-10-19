import type { Prisma } from '@prisma/client';
import { isVkPublicationPlatform } from '../vk_publication_route_contract';
type LegacyChannelBinding = { project_id: number; channel_id: number | null };
/** Resolve the actual scoped channel read-only before any legacy publishing/reset claim. */
export async function resolveLegacyPublicationChannel(db: Pick<Prisma.TransactionClient, 'socialChannel'>, post: LegacyChannelBinding) {
    if (post.channel_id !== null) {
        if (!Number.isInteger(post.channel_id) || post.channel_id <= 0) return null;
        return db.socialChannel.findFirst({ where: { id: post.channel_id, project_id: post.project_id } });
    }
    return db.socialChannel.findFirst({ where: { project_id: post.project_id, type: 'telegram' } });
}
/** Unknown, VK and LinkedIn bindings are held. Only known Telegram/Threads legacy transports retain their existing flow. */
export async function selectLegacyNonVkPosts<T extends LegacyChannelBinding>(db: Pick<Prisma.TransactionClient, 'socialChannel'>, posts: T[]): Promise<T[]> {
    const selected: T[] = [];
    for (const post of posts) {
        const channel = await resolveLegacyPublicationChannel(db, post);
        if (channel && !isVkPublicationPlatform(channel.type) && ['telegram','threads'].includes(channel.type.trim().toLowerCase())) selected.push(post);
    }
    return selected;
}
