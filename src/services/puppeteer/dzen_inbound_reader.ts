import { z } from 'zod';
import type { DzenConfig } from '../dzen.service';
import { dzenReadFailure } from '../dzen_radar';
import { parseDzenActivity, parseDzenStudioComments, parseDzenPublicThread, parseDzenChildThread } from '../dzen_inbound_contract';
import { dzenNativeJson, dzenReadUrl, withDzenReadonlyPage } from './dzen_readonly_browser';

const counts = z.object({ userId: z.union([z.string(),z.number()]).transform(String), since: z.number().optional(),
    count: z.number().int().nonnegative(), globalCount: z.number().int().nonnegative().optional() });
const studioEndpoint = '/editor-api/v2/social/editor/comments/latest_by_child';
const activityEndpoint = '/api/bell/notifications';

/** Read bounded native owned comments/replies and scoped notifications; never mark notifications read. */
export async function readDzenInbound(config: DzenConfig, options: { maxPages?: number; knownThreadUrls?: string[] }) {
    if (!Number.isInteger(options.maxPages ?? 1) || (options.maxPages ?? 1) < 1 || (options.maxPages ?? 1) > 3 || (options.knownThreadUrls?.length ?? 0) > 10) throw new Error('DZEN_READ_URL_INVALID');
    return withDzenReadonlyPage(config, async (page, publisherId, ownerUid) => {
        const maxPages = options.maxPages ?? 1;
        const evidence = `https://dzen.ru/profile/editor/id/${publisherId}/comments/`;
        const knownUrls = (options.knownThreadUrls ?? []).map(dzenReadUrl);
        const before = counts.parse(await dzenNativeJson(page, '/api/bell/notifications/count'));
        if (before.userId !== ownerUid) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
        const comments: ReturnType<typeof parseDzenStudioComments> = [];
        let commentPages = 0, commentCursor: string | null = null, commentsExhausted = false;
        let commentError = null;
        try {
            for (let index = 0; index < maxPages; index++) {
                const payload = await dzenNativeJson(page, studioEndpoint, { publisherId, limit: '40',
                    ...(commentCursor ? { commentIdAfter: commentCursor } : {}) });
                const rows = parseDzenStudioComments(payload, publisherId, ownerUid);
                commentPages++;
                comments.push(...rows);
                if (!rows.length) { commentsExhausted = true; commentCursor = null; break; }
                const cursor = rows.filter(row => row.kind === 'comment').slice(-1)[0]?.id;
                if (!cursor || cursor === commentCursor) throw new Error('DZEN_INBOUND_INTERFACE_CHANGED');
                commentCursor = cursor;
            }
        } catch (error: unknown) { commentError = dzenReadFailure(error); }
        let childThreadsRead = 0;
        if (!commentError) {
            const roots = comments.filter(row => row.kind === 'comment' && (row.children_count ?? 0) > comments.filter(child => child.parent_comment_id === row.id).length).slice(0,3);
            for (const root of roots) {
                try {
                    const children = parseDzenStudioComments(await dzenNativeJson(page, '/editor-api/v2/social/editor/comments/children',
                        { publisherId, rootId: root.id, limit: '40', sort: 'time-desc' }), publisherId, ownerUid);
                    if (children.some(child => child.parent_comment_id !== root.id)) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
                    comments.push(...children);
                    childThreadsRead++;
                } catch (error: unknown) { commentError = dzenReadFailure(error); break; }
            }
        }
        const events: ReturnType<typeof parseDzenActivity>['events'] = [];
        let excluded = 0, activityPages = 0, activityExhausted = false;
        let activityError = null;
        try {
            for (let index = 0; index < maxPages; index++) {
                const result = parseDzenActivity(await dzenNativeJson(page, activityEndpoint, { take: '25', skip: String(index * 25) }), publisherId, ownerUid, knownUrls);
                if (result.page_size !== 25 || result.offset !== index * 25) throw new Error('DZEN_INBOUND_INTERFACE_CHANGED');
                activityPages++;
                events.push(...result.events);
                excluded += result.excluded_unrelated_count;
                if (result.raw_count < 25) { activityExhausted = true; break; }
            }
        } catch (error: unknown) { activityError = dzenReadFailure(error); }
        const after = counts.parse(await dzenNativeJson(page, '/api/bell/notifications/count'));
        if (after.userId !== ownerUid) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
        const uniqueComments = [...new Map(comments.map(row => [row.id,row])).values()];
        const uniqueEvents = [...new Map(events.map(row => [row.id,row])).values()];
        return { schema_version: 1, status: commentError || activityError ? 'partial' : 'observed', complete: false,
            owned_channel: { status: 'observed', publisher_id: publisherId, access_verified: true, evidence_ref: evidence },
            captured_at: new Date().toISOString(), provenance: { source: 'dzen_native_authenticated_read', evidence_ref: evidence,
                comment_endpoint: studioEndpoint, activity_endpoint: activityEndpoint, account_identity_verified: true,
                mutation_requests_blocked: true, read_state_write_dispatched: false },
            comments: { status: commentError ? 'unknown' : 'observed', count: commentError ? null : uniqueComments.filter(row => row.kind === 'comment').length,
                items: uniqueComments, error: commentError, count_scope: 'returned_studio_rows',
                pagination: { pages_read: commentPages, exhausted: commentsExhausted, next_comment_id_after: commentCursor } },
            replies: { status: commentError ? 'unknown' : 'observed', count: commentError ? null : uniqueComments.filter(row => row.kind === 'reply').length,
                count_scope: 'returned_studio_child_rows', child_threads_read: childThreadsRead,
                unloaded_child_count: uniqueComments.some(row => row.kind === 'comment' && row.children_count === null) ? null : uniqueComments.reduce((sum,row) => sum + Math.max(0,(row.children_count ?? 0) - uniqueComments.filter(child => child.parent_comment_id === row.id).length),0),
                outside_owned_channel: 'Use Activity plus ba_dzen_read_thread for known external comment threads.' },
            activity: { status: activityError ? 'unknown' : 'observed', count: activityError ? null : uniqueEvents.length, events: uniqueEvents,
                scope: 'owned_channel_and_requested_threads', excluded_unrelated_count: excluded, error: activityError,
                pagination: { pages_read: activityPages, exhausted: activityExhausted, next_skip: activityExhausted ? null : activityPages * 25 },
                unread_observation: { before: before.count, after: after.count, unchanged: before.count === after.count && before.since === after.since,
                    concurrent_provider_changes_possible: true } } };
    });
}

/** Read public root comments on a canonical publication after validating the connected channel identity. */
export async function readDzenThread(config: DzenConfig, postUrl: string, maxReplyThreads = 3) {
    if (!Number.isInteger(maxReplyThreads) || maxReplyThreads < 0 || maxReplyThreads > 5) throw new Error('DZEN_READ_URL_INVALID');
    const url = dzenReadUrl(postUrl);
    return withDzenReadonlyPage(config, async (page, _publisherId, ownerUid) => {
        // Native /a and /b permalinks encode the 12-byte publication ID used by the comments API.
        const encodedId = new URL(url).pathname.match(/^\/[ab]\/([a-zA-Z0-9_-]{16})$/)?.[1];
        if (!encodedId) throw new Error('DZEN_THREAD_INTERFACE_CHANGED');
        const documentId = `native:${Buffer.from(encodedId, 'base64url').toString('hex')}`;
        // Short publications preload comments while navigating; arm before goto and bind the exact document/frame.
        const responsePromise = page.waitForResponse(response => {
            const native = new URL(response.url());
            return native.origin === 'https://dzen.ru' && native.pathname === '/api/comments/v2/root-comments' &&
                native.searchParams.get('documentId') === documentId && response.request().frame() === page.mainFrame();
        }, { timeout: 55_000 });
        const pending = responsePromise.then(response => ({ response }), () => ({ response: null }));
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
        if (dzenReadUrl(page.url()) !== url) throw new Error('DZEN_READ_URL_INVALID');
        await page.waitForSelector('[aria-label="Комментировать"]', { timeout: 15_000 });
        await page.click('[aria-label="Комментировать"]');
        const { response } = await pending;
        if (!response) throw new Error('DZEN_THREAD_INTERFACE_CHANGED');
        if ([401,403].includes(response.status())) throw new Error('DZEN_AUTH_REQUIRED');
        if (response.status() !== 200) throw new Error('DZEN_THREAD_INTERFACE_CHANGED');
        const rootResult = parseDzenPublicThread(await response.json(), documentId, ownerUid);
        const replies = [...rootResult.replies.items];
        const failures = [];
        let childThreadsRead = 0;
        for (const root of rootResult.comments.filter(row => (row.children_count ?? 0) > replies.filter(child => child.parent_comment_id === row.id).length).slice(0,maxReplyThreads)) {
            try {
                const requestUrl = new URL(response.url());
                const payload = await dzenNativeJson(page, '/api/comments/v2/child-comments', { documentId, rootCommentId: root.id,
                    ...(requestUrl.searchParams.get('publicationPublisherId') ? { publicationPublisherId: requestUrl.searchParams.get('publicationPublisherId')! } : {}),
                    withConfig: 'true', withCurrentUser: 'true' });
                replies.push(...parseDzenChildThread(payload, documentId, ownerUid, root.id));
                childThreadsRead++;
            } catch (error: unknown) { failures.push({ parent_comment_id: root.id, error: dzenReadFailure(error) }); }
        }
        const uniqueReplies = [...new Map(replies.map(row => [row.id,row])).values()];
        const replyComplete = rootResult.visibility === 'visible' && !failures.length && uniqueReplies.length === rootResult.native_counts.replies;
        return { schema_version: 1, status: 'observed', captured_at: new Date().toISOString(), post_url: url,
            provenance: { source: 'dzen_native_public_comments', evidence_ref: url, mutation_requests_blocked: true, sorting_write_dispatched: false },
            ...rootResult,
            complete: rootResult.visibility === 'visible' && replyComplete && rootResult.comments.length === rootResult.native_counts.roots,
            replies: { status: replyComplete ? 'observed' : failures.length || rootResult.visibility !== 'visible' ? 'unknown' : 'partial', count: failures.length || rootResult.visibility !== 'visible' ? null : uniqueReplies.length,
                items: uniqueReplies, complete: replyComplete, child_threads_read: childThreadsRead, errors: failures,
                reason: replyComplete ? 'native_child_rows_complete' : 'bounded_child_threads_incomplete' } };
    });
}
