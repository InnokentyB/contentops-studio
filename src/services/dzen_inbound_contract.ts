import { z } from 'zod';
import { dzenReadUrl } from './puppeteer/dzen_readonly_browser';

const id = z.number().int().nonnegative().safe();
const timestamp = z.number().int().nonnegative().safe();
const uid = z.union([z.string().regex(/^\d+$/), id]).transform(String);
const studioComment = z.object({ id, publisherId: z.string(), documentId: z.string(), createdTs: timestamp,
    authorUid: uid, authorPublisherId: z.string().optional(), text: z.string().nullable().optional(), rootId: id, replyToId: id });
const studioPayload = z.object({ status: z.literal('ok'), comments: z.array(studioComment).max(1000),
    counters: z.array(z.object({ id, childrenCount: id })).max(1000),
    users: z.array(z.object({ uid, displayName: z.string() })).max(1000),
    documentsPreviewInfos: z.array(z.object({ documentId: z.string(), url: z.string(), commonUrl: z.string().optional(), title: z.string() })).max(1000) });
const notification = z.object({ id: z.string(), recipientUid: uid, notificationType: z.string().max(100),
    publisherId: z.string(), targetUrl: z.string(), targetDescription: z.string().max(10000), lastActionTs: timestamp,
    parentCommentId: z.string().optional(), lastActors: z.array(z.object({ name: z.string().max(1000) })).max(100) });
const activityPayload = z.object({ notifications: z.array(notification).max(1000), take: id, skip: id });

/** Preserve native time; capture time never substitutes for the provider event timestamp. */
export function dzenEventTime(value: number): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || value < 1) throw new Error('DZEN_INBOUND_INTERFACE_CHANGED');
    return date.toISOString();
}

/** Normalize observed Studio schema v2; foreign publishers or malformed rows fail closed. */
export function parseDzenStudioComments(payload: unknown, publisherId: string, ownerUid: string) {
    const parsed = studioPayload.safeParse(payload);
    if (!parsed.success) throw new Error('DZEN_INBOUND_INTERFACE_CHANGED');
    const data = parsed.data;
    if (data.comments.some(comment => comment.publisherId !== publisherId)) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
    return data.comments.map(comment => {
        const preview = data.documentsPreviewInfos.find(document => document.documentId === comment.documentId);
        const author = data.users.find(user => user.uid === comment.authorUid);
        const counter = data.counters.find(counter => counter.id === comment.id);
        const parent = comment.rootId && comment.rootId !== comment.id ? String(comment.rootId) : null;
        return { id: String(comment.id), kind: parent ? 'reply' as const : 'comment' as const,
            parent_comment_id: parent, reply_to_id: comment.replyToId ? String(comment.replyToId) : null,
            text: comment.text ?? null, author_name: author?.displayName ?? null,
            is_connected_owner: comment.authorUid === ownerUid, created_at: dzenEventTime(comment.createdTs),
            children_count: counter?.childrenCount ?? null,
            post_url: preview ? dzenReadUrl(preview.commonUrl || preview.url) : null,
            post_title: preview?.title ?? null };
    });
}

/** Return channel-owned notifications and explicitly requested public threads; omit unrelated account activity. */
export function parseDzenActivity(payload: unknown, publisherId: string, ownerUid: string, knownThreadUrls: string[]) {
    const parsed = activityPayload.safeParse(payload);
    if (!parsed.success) throw new Error('DZEN_INBOUND_INTERFACE_CHANGED');
    if (parsed.data.notifications.some(event => event.recipientUid !== ownerUid)) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
    const urls = new Set(knownThreadUrls.map(dzenReadUrl));
    let excluded = 0;
    const events = [];
    for (const event of parsed.data.notifications) {
        const url = dzenReadUrl(event.targetUrl);
        if (event.publisherId !== publisherId && !urls.has(url)) { excluded++; continue; }
        events.push({ id: event.id, type: event.notificationType, occurred_at: dzenEventTime(event.lastActionTs),
            post_url: url, description: event.targetDescription, parent_comment_id: event.parentCommentId ?? null,
            actors: event.lastActors.map(actor => ({ name: actor.name })),
            scope: event.publisherId === publisherId ? 'owned_channel' as const : 'requested_public_thread' as const });
    }
    return { events, excluded_unrelated_count: excluded, page_size: parsed.data.take, offset: parsed.data.skip,
        raw_count: parsed.data.notifications.length };
}

const rootPayload = z.object({ status: z.literal('ok'), meta: z.object({ rootCommentsCount: id, childCommentsCount: id,
    totalCommentsCount: id, commentsVisibility: z.string(), appliedSorting: z.string() }),
    items: z.array(z.object({ entity: z.literal('comment'), entityData: z.object({ id, documentId: z.string(), createdTs: timestamp,
        authorUid: uid, text: z.string().max(10000).nullable().optional(), rootCommentId: id.optional(), replyToCommentId: id.optional() }) })).max(1000),
    usersById: z.record(z.string(), z.object({ displayName: z.string() })),
    metaByCommentId: z.record(z.string(), z.object({ childrenCount: id })),
    subthreadByCommentId: z.record(z.string(), z.array(z.object({ entity: z.literal('comment'), entityData: z.object({
        id, documentId: z.string(), createdTs: timestamp, authorUid: uid, text: z.string().max(10000).nullable().optional(), rootCommentId: id, replyToCommentId: id.optional() }) }))).optional() });

/** Read actual root comment bodies and declare unloaded child replies as a specific coverage gap. */
export function parseDzenPublicThread(payload: unknown, documentId: string, ownerUid: string) {
    const parsed = rootPayload.safeParse(payload);
    if (!parsed.success) throw new Error('DZEN_THREAD_INTERFACE_CHANGED');
    const data = parsed.data;
    const items = [...data.items, ...Object.values(data.subthreadByCommentId ?? {}).flat()];
    if (items.some(item => item.entityData.documentId !== documentId)) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
    const rows = [...new Map(items.map(({ entityData: comment }) => [String(comment.id), { id: String(comment.id), text: comment.text ?? null,
        author_name: data.usersById[comment.authorUid]?.displayName ?? null, is_connected_owner: comment.authorUid === ownerUid,
        created_at: dzenEventTime(comment.createdTs), parent_comment_id: comment.rootCommentId ? String(comment.rootCommentId) : null,
        reply_to_id: comment.replyToCommentId ? String(comment.replyToCommentId) : null,
        children_count: data.metaByCommentId[String(comment.id)]?.childrenCount ?? null }])).values()];
    const comments = rows.filter(row => !row.parent_comment_id);
    const replies = rows.filter(row => row.parent_comment_id);
    const repliesComplete = data.meta.commentsVisibility === 'visible' && replies.length === data.meta.childCommentsCount;
    return { comments, native_counts: { roots: data.meta.rootCommentsCount, replies: data.meta.childCommentsCount, total: data.meta.totalCommentsCount },
        sorting: data.meta.appliedSorting, visibility: data.meta.commentsVisibility,
        replies: { status: data.meta.commentsVisibility !== 'visible' ? 'unknown' as const : repliesComplete ? 'observed' as const : 'partial' as const,
            count: data.meta.commentsVisibility === 'visible' ? replies.length : null, items: replies, complete: repliesComplete,
            reason: repliesComplete ? 'native_child_rows_complete' : 'child_threads_not_loaded' },
        complete: data.meta.commentsVisibility === 'visible' && repliesComplete && comments.length === data.meta.rootCommentsCount };
}

/** Validate loaded child replies against the exact requested root and publication. */
export function parseDzenChildThread(payload: unknown, documentId: string, ownerUid: string, rootId: string) {
    const result = parseDzenPublicThread(payload, documentId, ownerUid);
    if (result.replies.items.some(row => row.parent_comment_id !== rootId)) throw new Error('DZEN_INBOUND_SCOPE_MISMATCH');
    return result.replies.items;
}
