import {ThreadsProviderError} from './threads_provider_error';
import {readThreadsApiJson} from './threads_api_reader';
export {ThreadsProviderError} from './threads_provider_error';
const API = 'https://graph.threads.net/v1.0';

type Options = { pollAttempts?: number; pollIntervalMs?: number };
type Profile = { id: string; username?: string; name?: string; threads_profile_picture_url?: string };
export type ThreadsPost = {
    id: string; text?: string; username?: string; permalink?: string; timestamp?: string;
    media_type?: string; media_url?: string; thumbnail_url?: string; has_replies?: boolean;
    is_reply?: boolean; is_reply_owned_by_me?: boolean;
    root_post?: { id?: string }; replied_to?: { id?: string };
};
type ThreadsPage = { data?: ThreadsPost[]; paging?: { cursors?: { after?: string }; next?: string } };
export type ThreadsPhaseJournal = {
    beforeCreate(): Promise<void>; containerCreated(id: string): Promise<void>;
    beforePublish(): Promise<void>; published(id: string): Promise<void>;
};

class ThreadsService {
    private readonly pollAttempts: number;
    private readonly pollIntervalMs: number;

    constructor(options: Options = {}) {
        this.pollAttempts = options.pollAttempts ?? 10;
        this.pollIntervalMs = options.pollIntervalMs ?? 500;
    }

    private async request<T>(operation: string, url: string, token: string, init: RequestInit = {}): Promise<T> {
        let response: Response;
        try {
            response = await fetch(url, { ...init, headers: {
                Authorization: `Bearer ${token}`,
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...(init.headers || {})
            } });
        } catch (error: unknown) {
            if (error instanceof Error && ['AbortError','TimeoutError'].includes(error.name)) {
                if(operation==='read_own_posts'||operation==='test_connection')throw new ThreadsProviderError('THREADS_PROVIDER_TIMEOUT', operation);
                throw error;
            }
            throw new ThreadsProviderError('THREADS_PROVIDER_UNAVAILABLE', operation);
        }
        if (!response.ok) throw new ThreadsProviderError('THREADS_PROVIDER_REQUEST_FAILED', operation, response.status);
        try {
            return await response.json() as T;
        } catch {
            throw new ThreadsProviderError('THREADS_PROVIDER_INVALID_RESPONSE', operation, response.status);
        }
    }

    private async permalink(postId: string, token: string, signal?: AbortSignal): Promise<string> {
        const result = await this.request<{ permalink?: string }>('read_permalink',
            `${API}/${encodeURIComponent(postId)}?fields=${encodeURIComponent('id,permalink')}`, token, { signal });
        if (!result.permalink) throw new ThreadsProviderError('THREADS_INVALID_PERMALINK', 'read_permalink');
        let url: URL;
        try { url = new URL(result.permalink); } catch {
            throw new ThreadsProviderError('THREADS_INVALID_PERMALINK', 'read_permalink');
        }
        if (url.protocol !== 'https:' || !['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(url.hostname)
            || !url.pathname.includes('/post/')) {
            throw new ThreadsProviderError('THREADS_INVALID_PERMALINK', 'read_permalink');
        }
        return url.toString();
    }

    private async waitForContainer(containerId: string, token: string): Promise<void> {
        for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
            const result = await this.request<{ status?: string }>('container_status',
                `${API}/${encodeURIComponent(containerId)}?fields=${encodeURIComponent('status,error_message')}`, token);
            if (result.status === 'FINISHED') return;
            if (result.status === 'ERROR' || result.status === 'EXPIRED') {
                throw new ThreadsProviderError('THREADS_CONTAINER_FAILED', 'container_status');
            }
            if (attempt + 1 < this.pollAttempts && this.pollIntervalMs > 0) {
                await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
            }
        }
        throw new ThreadsProviderError('THREADS_CONTAINER_TIMEOUT', 'container_status');
    }

    private async publishTextPost(userId: string, token: string, text: string, replyToId?: string, signal?: AbortSignal, journal?: ThreadsPhaseJournal) {
        await journal?.beforeCreate();
        const container = await this.request<{ id: string }>('create_text_container', `${API}/${encodeURIComponent(userId)}/threads`, token, {
            signal, method: 'POST', body: JSON.stringify({ media_type: 'TEXT', text, ...(replyToId ? { reply_to_id: replyToId } : {}) })
        });
        if (journal && (typeof container.id !== 'string' || !/^\d+$/.test(container.id))) throw new ThreadsProviderError('THREADS_PROVIDER_INVALID_RESPONSE', 'create_text_container');
        await journal?.containerCreated(container.id);
        await journal?.beforePublish();
        const published = await this.request<{ id: string }>('publish_text_container', `${API}/${encodeURIComponent(userId)}/threads_publish`, token, {
            signal, method: 'POST', body: JSON.stringify({ creation_id: container.id })
        });
        if (journal && (typeof published.id !== 'string' || !/^\d+$/.test(published.id))) throw new ThreadsProviderError('THREADS_PROVIDER_INVALID_RESPONSE', 'publish_text_container');
        await journal?.published(published.id);
        return { id: published.id, url: await this.permalink(published.id, token, signal) };
    }

    /** For fenced API execution: a failed readback is uncertain, never permission to resend. */
    async publishVerifiedText(userId: string, token: string, text: string, username: string, journal?: ThreadsPhaseJournal, callerSignal?:AbortSignal) {
        if (!/^\d+$/.test(userId) || !/^[A-Za-z0-9_.]+$/.test(username) || !text.trim() || text.length > 500) {
            throw new ThreadsProviderError('THREADS_INVALID_PUBLICATION_INPUT', 'verified_publish');
        }
        const timeout = AbortSignal.timeout(30_000);
        const signal = callerSignal ? AbortSignal.any([timeout,callerSignal]) : timeout;
        const result = await this.publishTextPost(userId, token, text, undefined, signal, journal);
        const post = await this.request<ThreadsPost>('verify_publication',
            `${API}/${encodeURIComponent(result.id)}?fields=${encodeURIComponent('id,text,username,permalink,timestamp')}`, token, { signal });
        let url: URL;
        try { url = new URL(post.permalink || ''); } catch {
            throw new ThreadsProviderError('THREADS_PUBLICATION_READBACK_MISMATCH', 'verify_publication');
        }
        if (!/^\d+$/.test(result.id) || post.id !== result.id || post.username !== username || post.text !== text
            || !post.timestamp || !Number.isFinite(Date.parse(post.timestamp)) || url.protocol !== 'https:'
            || url.username || url.password || url.port || url.search || url.hash
            || !['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(url.hostname)
            || !new RegExp(`^/@${username.replace(/\./g, '\\.')}\\/post\\/[A-Za-z0-9_-]+\\/?$`).test(url.pathname)) {
            throw new ThreadsProviderError('THREADS_PUBLICATION_READBACK_MISMATCH', 'verify_publication');
        }
        return { id: result.id, url: url.toString(), publishedAt: post.timestamp };
    }

    async publishThread(userId: string, token: string, posts: string[]) {
        if (posts.length < 2 || posts.some(post => !post.trim() || post.length > 500)) {
            throw new Error('Threads chain requires at least two non-empty posts of at most 500 characters each');
        }
        const published: Array<{ id: string; url: string }> = [];
        for (const post of posts) {
            published.push(await this.publishTextPost(userId, token, post,
                published.length ? published[published.length - 1].id : undefined));
        }
        return { rootUrl: published[0].url, postUrls: published.map(item => item.url) };
    }

    async searchPosts(token: string, args: { query: string; searchType?: 'TOP' | 'RECENT'; limit?: number; after?: string }) {
        const query = args.query.trim();
        if (query.length < 2 || query.length > 300) throw new Error('Threads search query must contain 2-300 characters');
        const limit = Math.min(50, Math.max(1, args.limit ?? 20));
        const params = new URLSearchParams({
            q: query,
            search_type: args.searchType ?? 'TOP',
            limit: String(limit),
            fields: 'id,media_type,media_url,permalink,username,text,timestamp,shortcode,thumbnail_url,has_replies,is_quote_post'
        });
        if (args.after) params.set('after', args.after);
        const result = await this.request<ThreadsPage>('search_posts', `${API}/keyword_search?${params}`, token);
        return { items: result.data || [], after: result.paging?.cursors?.after || null };
    }

    async getPost(token: string, postId: string): Promise<ThreadsPost> {
        return this.request<ThreadsPost>('read_post',
            `${API}/${encodeURIComponent(postId)}?fields=${encodeURIComponent('id,text,username,permalink,timestamp,media_type,has_replies')}`, token);
    }

    /** Bounded direct-object read for durable recovery; never publishes or probes arbitrary URLs. */
    async readRecoveryPost(token: string, postId: string, signal: AbortSignal): Promise<unknown> {
        if (!/^\d+$/.test(postId)) throw new ThreadsProviderError('THREADS_INVALID_PUBLICATION_INPUT', 'read_post');
        return readThreadsApiJson(`${API}/${encodeURIComponent(postId)}?fields=${encodeURIComponent('id,text,username,permalink,timestamp,media_type,is_reply')}`, token, signal);
    }

    async readRecoveryProfile(token: string, signal: AbortSignal): Promise<unknown> {
        return readThreadsApiJson(`${API}/me?fields=id,username`, token, signal);
    }

    async getOwnPosts(token: string, userId: string, after?: string, signal?: AbortSignal) {
        const params = new URLSearchParams({ fields: 'id,text,permalink,timestamp,username', limit: '100' });
        if (after) params.set('after', after);
        const result = await this.request<ThreadsPage>('read_own_posts',
            `${API}/${encodeURIComponent(userId)}/threads?${params}`, token, { signal });
        if (!Array.isArray(result.data) || (result.paging?.next && !result.paging.cursors?.after)) {
            throw new ThreadsProviderError('THREADS_HISTORY_INCOMPLETE', 'read_own_posts');
        }
        return { items: result.data || [], after: result.paging?.cursors?.after || null };
    }

    async getReplies(token: string, postId: string, args: {
        mode?: 'replies' | 'conversation'; reverse?: boolean; limit?: number; after?: string;
    } = {}) {
        const limit = Math.min(100, Math.max(1, args.limit ?? 25));
        const params = new URLSearchParams({
            fields: 'id,text,timestamp,media_type,permalink,shortcode,username,is_quote_post,has_replies,is_reply,is_reply_owned_by_me,root_post{id},replied_to{id}',
            reverse: String(args.reverse ?? false),
            limit: String(limit)
        });
        if (args.after) params.set('after', args.after);
        const mode = args.mode ?? 'replies';
        const result = await this.request<ThreadsPage>('read_replies',
            `${API}/${encodeURIComponent(postId)}/${mode}?${params}`, token);
        return { items: result.data || [], after: result.paging?.cursors?.after || null, mode };
    }

    async publishReply(userId: string, token: string, postId: string, text: string) {
        const normalized = text.trim();
        if (!normalized || normalized.length > 500) throw new Error('Threads reply must contain 1-500 characters');
        return this.publishTextPost(userId, token, normalized, postId);
    }

    async publishPost(userId: string, token: string, text: string, imageUrl?: string): Promise<string> {
        if (imageUrl) {
            try {
                if (new URL(imageUrl).protocol !== 'https:') throw new Error('HTTPS required');
            } catch { throw new ThreadsProviderError('THREADS_INVALID_IMAGE_URL', 'create_container'); }
        }
        const container = await this.request<{ id: string }>('create_container', `${API}/${encodeURIComponent(userId)}/threads`, token, {
            method: 'POST', body: JSON.stringify(imageUrl
                ? { media_type: 'IMAGE', image_url: imageUrl, text }
                : { media_type: 'TEXT', text })
        });
        if (imageUrl) await this.waitForContainer(container.id, token);
        const published = await this.request<{ id: string }>('publish_container', `${API}/${encodeURIComponent(userId)}/threads_publish`, token, {
            method: 'POST', body: JSON.stringify({ creation_id: container.id })
        });
        return this.permalink(published.id, token);
    }

    async getMetrics(postId: string, token: string): Promise<Record<string, number | string> | null> {
        try {
            const data = await this.request<{ data?: Array<{ name?: string; values?: Array<{ value?: number }> }> }>(
                'read_insights', `${API}/${encodeURIComponent(postId)}/insights?metric=likes,replies,reposts,quotes`, token);
            const metrics: Record<string, number | string> = { likes: 0, comments: 0, reposts: 0, views: 0 };
            for (const item of data.data || []) {
                const value = item.values?.[0]?.value || 0;
                if (item.name === 'likes') metrics.likes = value;
                if (item.name === 'replies') metrics.comments = value;
                if (item.name === 'reposts') metrics.reposts = value;
            }
            metrics.retrieved_at = new Date().toISOString();
            return metrics;
        } catch (error: unknown) {
            const safe = error instanceof ThreadsProviderError ? error : new ThreadsProviderError('THREADS_METRICS_FAILED', 'read_insights');
            console.error(`[ThreadsService] ${safe.message}`);
            return null;
        }
    }

    async testConnection(config: { access_token?: string; threads_user_id?: string; user_id?: string }): Promise<ThreadsTestConnectionResult> {
        const token = config.access_token?.trim();
        const expectedUserId = (config.threads_user_id || config.user_id)?.trim();
        if (!token) return { success: false, error: 'Access token is required' };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const data = await this.request<Profile>('test_connection',
                `${API}/me?fields=${encodeURIComponent('id,username,name,threads_profile_picture_url')}`, token, { signal: controller.signal });
            if (!data.id) return { success: false, error: 'Meta Threads API did not return a valid user profile' };
            if (expectedUserId && expectedUserId !== data.id) {
                return { success: false, error: `Threads User ID mismatch: configured "${expectedUserId}", but token belongs to "${data.id}" (@${data.username || 'unknown'})` };
            }
            return { success: true, details: data };
        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') return { success: false, error: 'Connection timed out after 10s' };
            const safe = error instanceof ThreadsProviderError ? error : new ThreadsProviderError('THREADS_CONNECTION_FAILED', 'test_connection');
            return { success: false, error: safe.message };
        } finally { clearTimeout(timeout); }
    }
}

export interface ThreadsTestConnectionResult { success: boolean; details?: Profile; error?: string }
export { ThreadsService };
export default new ThreadsService();
