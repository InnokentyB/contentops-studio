import crypto from 'crypto';
import prisma from '../db';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import dzenService, { type DzenConfig, isDzenPublishedUrl } from './dzen.service';
import metricsService from './metrics.service';
import { requireProjectActorAccess } from './project_access.service';

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
        const values = Object.fromEntries(['views', 'likes', 'comments'].map((name) => {
            const value = collected[name as 'views' | 'likes' | 'comments'];
            return [name, { value, status: value === null ? 'unknown' : 'observed' }];
        }));
        const day = collected.captured_at.slice(0, 10);
        const checkpoint = args.checkpoint || `dzen_daily_${day}`;
        const observedCount = Object.values(values).filter((metric: any) => metric.status === 'observed').length;
        const snapshot = await metricsService.recordMetricSnapshot({
            ...args,
            checkpoint,
            capturedAt: collected.captured_at,
            collectionMode: 'automatic',
            source: 'public_page',
            collectionStatus: observedCount === 3 ? 'collected' : observedCount > 0 ? 'partial' : 'unknown',
            evidenceRef: item.published_link,
            idempotencyKey: `dzen:${args.contentItemId}:${checkpoint}`,
            metrics: { schema_version: 1, values }
        });
        return { collected, snapshot };
    }

    async searchRelevantPosts(args: { projectId: number; actorId: string; channelId: number; query: string; limit?: number; minScore?: number }) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const posts = await dzenService.searchRelevantPosts(config, args.query.trim(), args.limit, args.minScore);
        return { query: args.query, posts, count: posts.length, source: 'dzen_public_search' };
    }

    async comment(args: { projectId: number; actorId: string; channelId: number; postUrl: string; text: string; idempotencyKey: string; confirm?: boolean }) {
        if (!isDzenPublishedUrl(args.postUrl)) throw new Error('INVALID_DZEN_POST_URL');
        const text = args.text.trim();
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const fingerprint = crypto.createHash('sha256').update(text).digest('hex');
        if (!args.confirm) {
            return { status: 'preview', will_publish: false, post_url: args.postUrl, text, text_fingerprint: fingerprint };
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
        const record = { ...result, text_fingerprint: fingerprint, published_at: new Date().toISOString() };
        await prisma.projectSettings.upsert({
            where: { project_id_key: { project_id: args.projectId, key: settingKey } },
            update: { value: JSON.stringify(record) },
            create: { project_id: args.projectId, key: settingKey, value: JSON.stringify(record) }
        });
        return record;
    }
}

export default new DzenEngagementService();
