import { z } from 'zod';

export const vkSearchInput = z.object({
    projectId: z.number().int().positive(), actorId: z.string().min(1).max(200), channelId: z.number().int().positive(),
    routes: z.array(z.object({ route: z.string().trim().min(1).max(100), queries: z.array(z.string().trim().min(2).max(200)).min(1).max(4) })).min(1).max(6),
    since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(100).default(30), minScore: z.number().min(0).max(1).default(0.2),
    maxPages: z.number().int().min(1).max(3).default(1)
}).refine(value => value.routes.reduce((n, route) => n + route.queries.length, 0) <= 12, 'At most 12 queries per search');
export type VkSearchInput = z.input<typeof vkSearchInput>;
export type SearchParams = Record<string, string | number>;
export type SearchDependencies = {
    authorize: (projectId: number, actorId: string) => Promise<void>;
    loadChannel: (projectId: number, channelId: number) => Promise<unknown>;
    search: (token: string, params: SearchParams) => Promise<unknown>;
    now: () => Date;
};
export type QueryEvidence = { route: string; query: string; status: 'searched' | 'evidence_limited' | 'blocked'; reason: string | null;
    pages: number; inspected: number; accepted: number; next_from: string | null; provider_error_code: number | null };
export type Identity = { id: number; name: string | null; url: string; kind: 'profile' | 'community' };
export type SearchPost = { id: string; post_id: number; owner_id: number; url: string; author: Identity | null; community: Identity | null;
    excerpt: string; timestamp: string; engagement: Record<'likes' | 'comments' | 'reposts' | 'views', number | null>;
    matches: Array<{ route: string; query: string; score: number; matched_terms: string[] }>;
    provenance: { source: 'vk_newsfeed_search'; method: 'newsfeed.search'; api_version: '5.199'; retrieved_at: string; public_visibility: 'provider_search' } };
export type SearchResult = { status: 'blocked' | 'evidence_limited'; source: 'vk_newsfeed_search'; retrieved_at: string;
    project_id: number; channel_id: number; freshness: { since: string; until: string }; posts: SearchPost[]; count: number;
    queries: QueryEvidence[]; owned_activity_status: 'unknown'; limitations: string[] };
