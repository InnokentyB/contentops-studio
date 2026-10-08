import { z } from 'zod';
import { Identity, SearchPost } from './contracts';
import { postSchema, responseSchema } from './provider';

type Page = z.infer<typeof responseSchema>;
function identity(id: number, page: Page): Identity {
    const group = id < 0 ? page.groups.find(row => row.id === -id) : null;
    const profile = id > 0 ? page.profiles.find(row => row.id === id) : null;
    return { id, kind: id < 0 ? 'community' : 'profile', url: `https://vk.com/${id < 0 ? `club${-id}` : `id${id}`}`,
        name: group?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || null };
}
function closed(id: number, page: Page): boolean {
    return id < 0 ? Boolean(page.groups.find(row => row.id === -id)?.is_closed) : Boolean(page.profiles.find(row => row.id === id)?.is_closed);
}

/** Validate each provider row independently and retain only fresh, relevant, apparently public posts. */
export function normalizeVkSearchPost(raw: unknown, page: Page, context: {
    route: string; query: string; since: number; until: number; minScore: number; retrievedAt: string;
}): SearchPost | null {
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return null;
    const post = parsed.data;
    if (post.friends_only || post.is_deleted || closed(post.owner_id, page) || (post.from_id && closed(post.from_id, page))) return null;
    if (post.date < context.since || post.date > context.until) return null;
    const terms = [...new Set(context.query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])];
    const text = post.text.toLocaleLowerCase();
    const matched = terms.filter(term => text.includes(term));
    const score = terms.length ? matched.length / terms.length : 0;
    if (score < context.minScore) return null;
    return { id: `${post.owner_id}_${post.id}`, post_id: post.id, owner_id: post.owner_id, url: `https://vk.com/wall${post.owner_id}_${post.id}`,
        author: post.from_id ? identity(post.from_id, page) : null, community: post.owner_id < 0 ? identity(post.owner_id, page) : null,
        excerpt: post.text.slice(0, 1200), timestamp: new Date(post.date * 1000).toISOString(),
        engagement: { likes: post.likes?.count ?? null, comments: post.comments?.count ?? null, reposts: post.reposts?.count ?? null, views: post.views?.count ?? null },
        matches: [{ route: context.route, query: context.query, score, matched_terms: matched }],
        provenance: { source: 'vk_newsfeed_search', method: 'newsfeed.search', api_version: '5.199', retrieved_at: context.retrievedAt, public_visibility: 'provider_search' } };
}
