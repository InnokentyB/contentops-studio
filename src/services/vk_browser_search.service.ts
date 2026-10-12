import { z } from 'zod';

/** Search jobs have no publication lease, credentials, or mutation authority. */
export const VkBrowserSearchJobSchema = z.object({
    schema_version: z.literal(1), action: z.literal('browser_search'), job_id: z.string().trim().min(1).max(200),
    project_id: z.number().int().positive(), channel_id: z.number().int().positive(),
    queries: z.array(z.string().trim().min(2).max(200)).min(1).max(3),
    since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }),
    topic_concepts: z.array(z.array(z.string().trim().min(2).max(80)).min(1).max(8)).min(2).max(6),
    max_unique_posts: z.number().int().min(1).max(100).default(100),
    max_scroll_rounds: z.number().int().min(1).max(10).default(10),
    deadline_ms: z.number().int().min(10).max(120_000).default(120_000)
}).strict().refine((job) => Date.parse(job.since) <= Date.parse(job.until), 'Invalid date window');
export type VkBrowserSearchJob = z.infer<typeof VkBrowserSearchJobSchema>;

const CardSchema = z.object({ post_id: z.string().max(100), text: z.string().max(20_000), author: z.string().max(200),
    author_url: z.string().max(2000).nullable(), published_at: z.string().max(100).nullable(),
    date_label: z.string().max(200), truncated: z.boolean() }).strict();
export type VkBrowserSearchCard = z.infer<typeof CardSchema>;

/** Scope is injected by the authenticated local handoff, never accepted from a post or page. */
export interface VkBrowserSearchUi {
    readonly surface_status: 'fixture' | 'verified' | 'unverified';
    readonly scope: { project_id: number; channel_id: number; permission: 'search_only' };
    navigateSearch(url: string): Promise<void>;
    readCards(): Promise<unknown[]>;
    expandPost(postId: string): Promise<boolean>;
    scrollOnce(): Promise<boolean>;
}
interface Evidence {
    post_id: string; public_url: string; original_text: string; author: string; author_url: string | null;
    observed_publication_time: string | null; date_label: string; truncated: boolean;
    exclusion: 'unknown_date' | 'outside_window' | 'off_topic' | 'unexpanded' | 'unknown_author' | 'future_date' | null;
    matched_concepts: string[];
}
interface SearchResult {
    status: 'evidence_limited' | 'blocked'; job_id: string; project_id: number; channel_id: number;
    posts: Evidence[]; evidence: Evidence[];
    coverage: { partial: true; exhaustive: false; ordering: 'provider_relevant_first'; queries_started: number;
        unique_posts_scanned: number; duplicates: number; invalid_cards: number; scroll_rounds: number;
        stop_reason: string; elapsed_ms: number; provider_activity: 'unknown'; live_verified: boolean };
}
function normalize(value: string): string { return value.toLocaleLowerCase('ru').normalize('NFKC').replace(/\s+/g, ' ').trim(); }
function profileUrl(raw: string | null): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && ['vk.com', 'vk.ru'].includes(url.hostname) && !url.port
            && !url.username && !url.password && /^\/[\w.-]+$/.test(url.pathname)
            ? `https://vk.com${url.pathname}` : null;
    } catch { return null; /* An invalid provider profile is represented explicitly as unknown. */ }
}
function publicationTime(raw: string | null): string | null {
    if (!raw || !z.string().datetime({ offset: true }).safeParse(raw).success) return null;
    return new Date(raw).toISOString();
}
function classify(card: VkBrowserSearchCard, job: VkBrowserSearchJob): Evidence | null {
    if (!/^-?[1-9]\d*_[1-9]\d*$/.test(card.post_id)) return null;
    const text = normalize(card.text);
    const concepts = [...new Set(job.topic_concepts.map((alternatives) => alternatives.find((term) => text.includes(normalize(term))))
        .filter((term): term is string => Boolean(term)))];
    const published = publicationTime(card.published_at);
    const exclusion = card.truncated ? 'unexpanded' : !card.author.trim() ? 'unknown_author'
        : !published ? 'unknown_date' : Date.parse(published) > Date.now() + 30_000 ? 'future_date'
        : Date.parse(published) < Date.parse(job.since) || Date.parse(published) > Date.parse(job.until)
            ? 'outside_window' : concepts.length < 2 ? 'off_topic' : null;
    return { post_id: card.post_id, public_url: `https://vk.com/wall${card.post_id}`, original_text: card.text,
        author: card.author, author_url: profileUrl(card.author_url), observed_publication_time: published,
        date_label: card.date_label, truncated: card.truncated, exclusion, matched_concepts: concepts };
}
async function bounded<T>(operation: () => Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('SEARCH_DEADLINE')), ms);
    })]); } finally { if (timer) clearTimeout(timer); }
}

/** Run bounded relevant-first discovery; provider text is evidence data and never an instruction. */
export async function runVkBrowserSearch(rawJob: unknown, ui: VkBrowserSearchUi): Promise<SearchResult> {
    const job = VkBrowserSearchJobSchema.parse(rawJob);
    if (ui.scope.project_id !== job.project_id || ui.scope.channel_id !== job.channel_id || ui.scope.permission !== 'search_only') {
        throw new Error('[VK_BROWSER_SEARCH_SCOPE_MISMATCH] Search handoff scope does not match');
    }
    const began = Date.now();
    const result: SearchResult = { status: ui.surface_status === 'unverified' ? 'blocked' : 'evidence_limited',
        job_id: job.job_id, project_id: job.project_id, channel_id: job.channel_id, posts: [], evidence: [],
        coverage: { partial: true, exhaustive: false, ordering: 'provider_relevant_first', queries_started: 0,
            unique_posts_scanned: 0, duplicates: 0, invalid_cards: 0, scroll_rounds: 0,
            stop_reason: ui.surface_status === 'unverified' ? 'VK_BROWSER_SEARCH_UI_UNVERIFIED' : 'no_new_visible_posts',
            elapsed_ms: 0, provider_activity: 'unknown', live_verified: ui.surface_status === 'verified' } };
    if (result.status === 'blocked') return result;
    const seen = new Set<string>();
    const expanded = new Set<string>();
    const remaining = (): number => Math.max(1, Math.min(30_000, job.deadline_ms - (Date.now() - began)));
    const step = <T>(operation: () => Promise<T>): Promise<T> => bounded(operation, remaining());
    try {
        queries: for (const query of job.queries) {
            if (Date.now() - began >= job.deadline_ms) { result.coverage.stop_reason = 'deadline'; break; }
            const url = new URL('https://vk.com/search/statuses'); url.searchParams.set('q', query);
            result.coverage.queries_started += 1;
            await step(() => ui.navigateSearch(url.toString()));
            while (true) {
                const cards = await step(() => ui.readCards());
                for (const rawCard of cards.slice(0, 200)) {
                    const parsed = CardSchema.safeParse(rawCard);
                    if (!parsed.success) { result.coverage.invalid_cards += 1; continue; }
                    let card = parsed.data;
                    if (!/^-?[1-9]\d*_[1-9]\d*$/.test(card.post_id)) { result.coverage.invalid_cards += 1; continue; }
                    if (seen.has(card.post_id)) { result.coverage.duplicates += 1; continue; }
                    if (card.truncated && !expanded.has(card.post_id)) {
                        expanded.add(card.post_id);
                        if (await step(() => ui.expandPost(card.post_id))) {
                            const reread = await step(() => ui.readCards());
                            const current = reread.slice(0, 200).map((item) => CardSchema.safeParse(item))
                                .find((item) => item.success && item.data.post_id === card.post_id);
                            if (current?.success) card = current.data;
                        }
                    }
                    seen.add(card.post_id);
                    const evidence = classify(card, job);
                    if (evidence) { result.evidence.push(evidence); if (!evidence.exclusion) result.posts.push(evidence); }
                    result.coverage.unique_posts_scanned = seen.size;
                    if (seen.size >= job.max_unique_posts) { result.coverage.stop_reason = 'unique_post_limit'; break queries; }
                    if (Date.now() - began >= job.deadline_ms) { result.coverage.stop_reason = 'deadline'; break queries; }
                }
                if (result.coverage.scroll_rounds >= job.max_scroll_rounds) { result.coverage.stop_reason = 'scroll_limit'; break queries; }
                result.coverage.scroll_rounds += 1;
                if (!await step(() => ui.scrollOnce())) break;
            }
        }
    } catch (error: unknown) {
        result.coverage.stop_reason = error instanceof Error && error.message === 'SEARCH_DEADLINE' ? 'deadline' : 'provider_read_failed';
        if (!result.evidence.length) result.status = 'blocked';
    }
    result.coverage.elapsed_ms = Date.now() - began;
    return result;
}
