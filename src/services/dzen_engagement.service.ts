import { z } from 'zod';
import { readDzenArticle } from './puppeteer/dzen_article_reader';
import { monitorDzenReplies } from './dzen_reply_monitor';
import { dzenReadUrl } from './puppeteer/dzen_readonly_browser';
import crypto from 'crypto';
import prisma from '../db';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import dzenService, { type DzenConfig, isDzenPublishedUrl } from './dzen.service';
import metricsService from './metrics.service';
import { requireProjectActorAccess } from './project_access.service';
import { buildDzenRadarCoverage, dzenReadFailure, screenDzenCard, type DzenRadarCoverage } from './dzen_radar';

import { readDzenInbound, readDzenThread } from './puppeteer/dzen_inbound_reader';

const DZEN_TYPES = new Set(['dzen', 'zen', 'zen_article']);

class DzenEngagementService {
    private async getChannel(projectId: number, channelId: number, actorId: string): Promise<DzenConfig> {
        await requireProjectActorAccess(projectId, actorId);
        const channel = await prisma.socialChannel.findFirst({
            where: { id: channelId, project_id: projectId, is_active: true },
            select: { type: true, config: true }
        });
        if (!channel || !DZEN_TYPES.has(channel.type)) throw new Error('ACTIVE_DZEN_CHANNEL_NOT_FOUND');
        return resolveEffectiveChannelConfig(channel.type, channel.config) as DzenConfig;
    }

    async collectPostMetrics(args: { projectId: number; actorId: string; channelId: number; contentItemId: number; checkpoint?: string }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const item = await prisma.contentItem.findFirst({
            where: { id: args.contentItemId, project_id: args.projectId, channel_id: args.channelId },
            select: { published_link: true }
        });
        if (!item?.published_link || !isDzenPublishedUrl(item.published_link)) throw new Error('DZEN_PUBLICATION_URL_NOT_FOUND');
        const collected = await dzenService.collectPostMetrics(config, item.published_link);
        const metricNames = ['views', 'likes', 'comments', 'impressions', 'pageViews', 'clicks', 'deepViews', 'shares', 'subscriptions', 'sumViewTimeSec', 'ctr'] as const;
        const values = Object.fromEntries(metricNames.map((name) => {
            const value = collected[name];
            return [name, { value, status: value === null ? 'unknown' : 'observed' }];
        }));
        const day = collected.captured_at.slice(0, 10);
        const checkpoint = args.checkpoint || `dzen_daily_${day}`;
        const observedCount = Object.values(values).filter((metric) => metric.status === 'observed').length;
        const snapshot = await metricsService.recordMetricSnapshot({
            ...args,
            checkpoint,
            capturedAt: collected.captured_at,
            collectionMode: 'automatic',
            source: 'public_page',
            collectionStatus: observedCount === metricNames.length ? 'collected' : observedCount > 0 ? 'partial' : 'unknown',
            evidenceRef: item.published_link,
            idempotencyKey: `dzen:${args.contentItemId}:${checkpoint}`,
            metrics: { schema_version: 1, values }
        });
        return { collected, snapshot };
    }

    /** Return adapter coverage, not a live session or owned-channel scan. */
    async getRadarCoverage(args: { projectId: number; actorId: string; channelId: number }): Promise<DzenRadarCoverage> {
        await this.getChannel(args.projectId, args.channelId, args.actorId);
        return buildDzenRadarCoverage(args.projectId, args.channelId, new Date().toISOString());
    }

    /** Read native inbound surfaces only after authorizing the active project channel. */
    async readInbound(args: { projectId: number; actorId: string; channelId: number; maxPages?: number; knownThreadUrls?: string[] }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        try { return { project_id: args.projectId, channel_id: args.channelId, ...await readDzenInbound(config, args) }; }
        catch (error: unknown) { return { project_id: args.projectId, channel_id: args.channelId, status: 'unknown', complete: false,
            count: null, error: dzenReadFailure(error), captured_at: new Date().toISOString() }; }
    }

    /** Read one exact public comment thread through the authorized connection. */
    async readThread(args: { projectId: number; actorId: string; channelId: number; postUrl: string; maxReplyThreads?: number }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        try { return { project_id: args.projectId, channel_id: args.channelId, ...await readDzenThread(config, args.postUrl, args.maxReplyThreads) }; }
        catch (error: unknown) { return { project_id: args.projectId, channel_id: args.channelId, status: 'unknown', complete: false,
            count: null, error: dzenReadFailure(error), captured_at: new Date().toISOString() }; }
    }

    /** Read the primary article body after enforcing project and channel authorization. */
    async readPost(args: {projectId:number;actorId:string;channelId:number;postUrl:string}) {
        const config = await this.getChannel(args.projectId,args.channelId,args.actorId);
        try { return {project_id:args.projectId,channel_id:args.channelId,...await readDzenArticle(config,args.postUrl)}; }
        catch(error:unknown) {return {project_id:args.projectId,channel_id:args.channelId,status:'unknown',complete:false,text:null,article_body_read:false,error:dzenReadFailure(error)};}
    }

    /** Discover monitor targets from tenant/channel-bound Planner facts and exact caller-known threads. */
    async findReplies(args:{projectId:number;actorId:string;channelId:number;knownThreadUrls?:string[];maxPages?:number;maxThreads?:number;since?:string}) {
        const config = await this.getChannel(args.projectId,args.channelId,args.actorId);
        const publications = await prisma.contentItem.findMany({where:{project_id:args.projectId,channel_id:args.channelId,published_link:{not:null}},orderBy:{updated_at:'desc'},take:10,select:{published_link:true}});
        const settings = await prisma.projectSettings.findMany({where:{project_id:args.projectId,key:{startsWith:'dzen_comment:'}},orderBy:{updated_at:'desc'},take:100,select:{value:true}});
        const recordSchema = z.object({channel_id:z.literal(args.channelId),status:z.enum(['published','already_exists']),url:z.string()});
        const storedUrls:string[] = [];
        let invalidRecords = 0;
        for (const setting of settings) {
            try { const result = recordSchema.safeParse(JSON.parse(setting.value));
                if (result.success) storedUrls.push(dzenReadUrl(result.data.url));
                else invalidRecords++;
            } catch { invalidRecords++; }
        }
        const urls = [...new Set([...(args.knownThreadUrls ?? []).map(dzenReadUrl),...storedUrls,...publications.flatMap(row=>row.published_link ? [dzenReadUrl(row.published_link)] : [])])];
        try {return {project_id:args.projectId,channel_id:args.channelId,
            ...await monitorDzenReplies(config,{...args,knownThreadUrls:urls.slice(0,10)}),
            target_discovery:{source:'explicit_threads_and_channel_bound_planner_facts',known_urls:urls.slice(0,10),omitted_url_count:Math.max(0,urls.length-10),unbound_or_invalid_comment_records:invalidRecords,
                legacy_comment_records_require_explicit_thread_urls:true,publication_facts_limit:10,comment_records_limit:100}};
        } catch(error:unknown) {return {project_id:args.projectId,channel_id:args.channelId,status:'unknown',complete:false,count:null,error:dzenReadFailure(error)};}
    }

    async searchRelevantPosts(args: { projectId: number; actorId: string; channelId: number; query: string; limit?: number; minScore?: number }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const checkedAt = new Date().toISOString();
        const coverage = buildDzenRadarCoverage(args.projectId, args.channelId, checkedAt);
        const provenance = { captured_at: checkedAt, source: 'dzen_search_cards',
            evidence_ref: `https://dzen.ru/search?query=${encodeURIComponent(args.query.trim())}`,
            count_scope: 'returned_relevance_filtered_cards', limit: args.limit ?? 10, min_score: args.minScore ?? 25 };
        try {
            const results = await dzenService.searchRelevantPosts(config, args.query.trim(), args.limit, args.minScore);
            const capturedAt = new Date().toISOString();
            const posts = results.map(post => screenDzenCard(post, capturedAt));
            provenance.captured_at = capturedAt;
            coverage.surfaces.public_discovery = { status: 'observed', count: posts.length,
                reason: { code: 'bounded_cards_observed', evidence: [provenance.evidence_ref],
                    next_step: 'Read candidate bodies and native dates; this bounded result is not a complete feed scan.' } };
            return { query: args.query, posts, next_steps: ['ba_dzen_read_post', 'ba_dzen_read_thread'], candidate_acceptance: 'requires_article_and_discussion_review', count: posts.length, source: 'dzen_public_search',
                status: 'observed' as const, error: null, coverage, provenance };
        } catch (error: unknown) {
            return { query: args.query, posts: [], count: null, source: 'dzen_public_search',
                status: 'unknown' as const, error: dzenReadFailure(error), coverage, provenance };
        }
    }

    async comment(args: { projectId: number; actorId: string; channelId: number; postUrl: string; text: string; idempotencyKey: string; confirm?: boolean }) {
        if (!isDzenPublishedUrl(args.postUrl)) throw new Error('INVALID_DZEN_POST_URL');
        const text = args.text.trim();
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const fingerprint = crypto.createHash('sha256').update(text).digest('hex');
        if (!args.confirm) {
            const preflight = await dzenService.preflightComment(config, args.postUrl);
            return {
                status: preflight.status === 'ready' ? 'preview' : 'interface_changed',
                will_publish: false,
                executable: preflight.status === 'ready',
                blocker: preflight.status === 'ready' ? null : 'interface_changed',
                post_url: args.postUrl,
                text,
                text_fingerprint: fingerprint,
                preflight
            };
        }
        const keyHash = crypto.createHash('sha256').update(`${args.channelId}:${args.postUrl}:${args.idempotencyKey}`).digest('hex');
        const settingKey = `dzen_comment:${keyHash}`;
        const existing = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: args.projectId, key: settingKey } }
        });
        if (existing) {
            const previous = JSON.parse(existing.value);
            if (previous.text_fingerprint !== fingerprint) throw new Error('DZEN_COMMENT_IDEMPOTENCY_CONFLICT');
            return { ...previous, idempotent_replay: true };
        }
        const result = await dzenService.comment(config, args.postUrl, text);
        const record = { ...result, channel_id: args.channelId, text_fingerprint: fingerprint, published_at: new Date().toISOString() };
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: args.projectId, key: settingKey } },
            update: { value: JSON.stringify(record) },
            create: { project_id: args.projectId, key: settingKey, value: JSON.stringify(record) }
        });
        return record;
    }
}

export default new DzenEngagementService();
