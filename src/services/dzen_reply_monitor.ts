import { z } from 'zod';
import type { DzenConfig } from './dzen.service';
import { dzenReadFailure } from './dzen_radar';
import { dzenReadUrl } from './puppeteer/dzen_readonly_browser';
import { readDzenInbound, readDzenThread } from './puppeteer/dzen_inbound_reader';

const rowSchema = z.object({ id:z.string(), text:z.string().nullable(), author_name:z.string().nullable(),
    is_connected_owner:z.boolean(), created_at:z.string(), parent_comment_id:z.string().nullable(), reply_to_id:z.string().nullable() });
const threadSchema = z.object({ status:z.literal('observed'), complete:z.boolean(), post_url:z.string(),
    comments:z.array(rowSchema), replies:z.object({items:z.array(rowSchema),complete:z.boolean()}) });

type ReplyRow = z.infer<typeof rowSchema>;
interface ReplyThread {
    post_url:string;status:string;complete:boolean;own_comments:ReplyRow[];replies:ReplyRow[];conversation_activity:ReplyRow[];gaps:string[];
}
type InboundResult = Awaited<ReturnType<typeof readDzenInbound>>;
interface MonitorResult {
    schema_version:number;status:string;complete:boolean;captured_at:string;since:string|null;count_scope:string;
    owned_publication_responses:{status:string;count:number|null;items:InboundResult['comments']['items']};
    replies_to_our_comments:{status:string;count:number|null;items:(ReplyRow & {post_url:string})[]};
    threads:ReplyThread[];unscanned_thread_urls:string[];activity:InboundResult['activity'];
    owned_pagination:InboundResult['comments']['pagination'];owned_child_coverage:InboundResult['replies'];gaps:string[];
    provenance:{source:string;mutation_requests_blocked:boolean;read_state_write_dispatched:boolean};
}

/** Match native direct reply IDs to any connected-owner root or child; root ancestry alone is only a conversation signal. */
export function matchDzenReplies(payload: unknown): ReplyThread {
    const parsed = threadSchema.safeParse(payload);
    if (!parsed.success) throw new Error('DZEN_THREAD_INTERFACE_CHANGED');
    const data = parsed.data;
    const rows = [...data.comments,...data.replies.items];
    const ownIds = new Set(rows.filter(row=>row.is_connected_owner).map(row=>row.id));
    const ownRoots = new Set(data.comments.filter(row=>row.is_connected_owner).map(row=>row.id));
    return { post_url:dzenReadUrl(data.post_url), status:data.complete ? 'observed' : 'partial', complete:data.complete,
        own_comments:rows.filter(row=>row.is_connected_owner),
        replies:data.replies.items.filter(row=>!row.is_connected_owner && row.reply_to_id !== null && ownIds.has(row.reply_to_id)),
        conversation_activity:data.replies.items.filter(row=>!row.is_connected_owner && row.parent_comment_id !== null && ownRoots.has(row.parent_comment_id) && (!row.reply_to_id || !ownIds.has(row.reply_to_id))),
        gaps:data.complete ? [] : ['bounded_thread_incomplete_owner_comments_or_replies_may_be_unloaded'] };
}

/** Combine owned publication inbound and bounded known external threads. Never infer an unobserved reply count as zero. */
export async function monitorDzenReplies(config:DzenConfig, options:{knownThreadUrls:string[];maxPages?:number;maxThreads?:number;since?:string}): Promise<MonitorResult> {
    const maxThreads = options.maxThreads ?? 3;
    if (!Number.isInteger(maxThreads) || maxThreads < 1 || maxThreads > 5 || options.knownThreadUrls.length > 10) throw new Error('DZEN_READ_URL_INVALID');
    const threshold = options.since ? Date.parse(options.since) : null;
    if (threshold !== null && !Number.isFinite(threshold)) throw new Error('DZEN_READ_URL_INVALID');
    const urls = [...new Set(options.knownThreadUrls.map(dzenReadUrl))];
    const inbound = await readDzenInbound(config,{maxPages:options.maxPages,knownThreadUrls:urls});
    const threads = [];
    for (const url of urls.slice(0,maxThreads)) {
        try { threads.push(matchDzenReplies(await readDzenThread(config,url,5))); }
        catch(error:unknown) { threads.push({post_url:url,status:'unknown',complete:false,own_comments:[],replies:[],conversation_activity:[],gaps:[dzenReadFailure(error).code]}); }
    }
    const recent = (row:{created_at:string}) => threshold === null || Date.parse(row.created_at) >= threshold;
    const owned = inbound.comments.items.filter(row=>!row.is_connected_owner && recent(row));
    const direct = threads.flatMap(thread=>thread.replies.filter(recent).map(row=>({...row,post_url:thread.post_url})));
    return {schema_version:1,status:inbound.status === 'partial' || threads.some(thread=>!thread.complete) || urls.length > maxThreads ? 'partial' : 'observed',
        complete:false,captured_at:new Date().toISOString(),since:options.since ?? null,
        count_scope:'returned_owned_studio_rows_and_loaded_known_threads',
        owned_publication_responses:{status:inbound.comments.status,count:inbound.comments.status === 'unknown' ? null : owned.length,items:owned},
        replies_to_our_comments:{status:threads.some(thread=>!thread.complete) || urls.length > maxThreads ? 'partial' : urls.length ? 'observed' : 'unknown',
            count:threads.some(thread=>!thread.complete) || urls.length > maxThreads || !urls.length ? null : direct.length,items:direct},
        threads,unscanned_thread_urls:urls.slice(maxThreads),activity:inbound.activity,
        owned_pagination:inbound.comments.pagination,owned_child_coverage:inbound.replies,
        gaps:['bounded_history_not_global_reply_search',...(!urls.length?['no_known_external_threads']:[])],
        provenance:{source:'dzen_native_reply_monitor',mutation_requests_blocked:true,read_state_write_dispatched:false}};
}
