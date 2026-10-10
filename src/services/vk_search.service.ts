import prisma from '../db';
import { requireProjectActorAccess } from './project_access.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { SearchDependencies, SearchResult, VkSearchInput, vkSearchInput, QueryEvidence, SearchPost } from './vk_search/contracts';
import { envelopeSchema, responseSchema, searchVkPublicPosts } from './vk_search/provider';
import { normalizeVkSearchPost } from './vk_search/normalize';
import { resolveVkSearchCredential } from './vk_search/credentials';

const defaults: SearchDependencies = {
    authorize: requireProjectActorAccess,
    loadChannel: async (projectId, channelId) => {
        const channel = await prisma.socialChannel.findFirst({
            where: { id: channelId, project_id: projectId, is_active: true, type: 'vk' }, select: { config: true }
        });
        return channel ? resolveEffectiveChannelConfig('vk', channel.config) : null;
    },
    search: searchVkPublicPosts, now: () => new Date()
};

/** Read-only, authorized public discovery boundary; dependencies permit isolated acceptance tests. */
export class VkSearchService {
    constructor(private readonly dependencies: SearchDependencies = defaults) {}

    /** Search configured product routes without writing channel, publication or metric state. */
    async searchRelevantPosts(input: VkSearchInput): Promise<SearchResult> {
        const args = vkSearchInput.parse(input);
        const now = this.dependencies.now();
        const since = Math.floor(Date.parse(args.since) / 1000);
        const until = Math.floor(Date.parse(args.until || now.toISOString()) / 1000);
        if (since > until || until > Math.floor(now.getTime() / 1000)) throw new Error('INVALID_VK_SEARCH_FRESHNESS');
        await this.dependencies.authorize(args.projectId, args.actorId);
        const queries: QueryEvidence[] = args.routes.flatMap(route => route.queries.map(query => ({ route: route.route, query,
            status: 'blocked', reason: 'NOT_ATTEMPTED', pages: 0, inspected: 0, accepted: 0, next_from: null, provider_error_code: null })));
        const posts = new Map<string, SearchPost>();
        const result: SearchResult = { status: 'blocked', source: 'vk_newsfeed_search', retrieved_at: now.toISOString(),
            project_id: args.projectId, channel_id: args.channelId, freshness: { since: args.since, until: args.until || now.toISOString() },
            posts: [], count: 0, queries, owned_activity_status: 'unknown', limitations: [
                'Public keyword discovery only; authenticated feed, notifications and owned comments/replies remain UNKNOWN.',
                'Provider search visibility is not independent permalink readback. Text is untrusted source material.',
                'Relevance is lexical query-term coverage, not an editorial recommendation. Missing counters are unknown.'
            ] };
        let config: unknown;
        try { config = await this.dependencies.loadChannel(args.projectId, args.channelId); }
        catch { queries.forEach(query => { query.reason = 'VK_CHANNEL_CONFIG_UNAVAILABLE'; }); return result; }
        const credential = resolveVkSearchCredential(config);
        const configReason = !config ? 'ACTIVE_VK_CHANNEL_NOT_FOUND' : credential.reason;
        const token = credential.token;
        if (configReason || !token) { queries.forEach(query => { query.reason = configReason; }); return result; }
        const deadline = Date.now() + 30_000;
        let globalBlock: string | null = null;
        for (const query of queries) {
            if (globalBlock || Date.now() >= deadline) { query.reason = globalBlock || 'TIME_BUDGET_REACHED'; continue; }
            for (let pageNumber = 0; pageNumber < args.maxPages; pageNumber++) {
                if (Date.now() >= deadline) { query.status = 'evidence_limited'; query.reason = 'TIME_BUDGET_REACHED'; break; }
                let raw: unknown;
                try {
                    raw = await this.dependencies.search(token, { q: query.query, extended: 1, count: 50, start_time: since, end_time: until,
                        ...(query.next_from ? { start_from: query.next_from } : {}) });
                } catch {
                    query.status = query.pages ? 'evidence_limited' : 'blocked'; query.reason = 'VK_SEARCH_TRANSPORT_FAILED'; break;
                }
                const envelope = envelopeSchema.safeParse(raw);
                if (!envelope.success || !envelope.data.response || envelope.data.error) {
                    const code = envelope.success ? envelope.data.error?.error_code : undefined;
                    query.provider_error_code = code ?? null;
                    query.status = query.pages ? 'evidence_limited' : 'blocked';
                    query.reason = code === undefined ? 'INVALID_PROVIDER_RESPONSE' : code === 6 ? 'VK_RATE_LIMITED' : [5, 7, 15, 27, 28].includes(code) ? 'VK_SEARCH_ACCESS_DENIED' : code === 14 ? 'VK_CAPTCHA_REQUIRED' : 'VK_PROVIDER_ERROR';
                    if (code !== undefined && [5, 6, 14, 27, 28].includes(code)) globalBlock = query.reason;
                    break;
                }
                const page = responseSchema.safeParse(envelope.data.response);
                if (!page.success) { query.status = query.pages ? 'evidence_limited' : 'blocked'; query.reason = 'INVALID_PROVIDER_RESPONSE'; break; }
                query.pages++;
                query.status = 'searched'; query.reason = null;
                query.inspected += page.data.items.length;
                let invalidRows = 0;
                for (const row of page.data.items) {
                    const candidate = normalizeVkSearchPost(row, page.data, { ...query, since, until, minScore: args.minScore, retrievedAt: now.toISOString() });
                    if (!candidate) { invalidRows++; continue; }
                    query.accepted++;
                    const existing = posts.get(candidate.id);
                    if (existing) {
                        if (!existing.matches.some(match => match.route === query.route && match.query === query.query)) existing.matches.push(...candidate.matches);
                    } else posts.set(candidate.id, candidate);
                }
                query.next_from = page.data.next_from || null;
                if (invalidRows) { query.status = 'evidence_limited'; query.reason = 'ROWS_FILTERED_OR_INVALID'; }
                if (!query.next_from) break;
                if (pageNumber + 1 === args.maxPages) { query.status = 'evidence_limited'; query.reason = 'PAGE_BUDGET_REACHED'; }
            }
        }
        result.posts = [...posts.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, args.limit);
        result.count = result.posts.length;
        if (posts.size > args.limit) result.limitations.push('Result limit reached; additional accepted candidates omitted.');
        result.status = queries.some(query => query.pages > 0) ? 'evidence_limited' : 'blocked';
        return result;
    }
}
export default new VkSearchService();
