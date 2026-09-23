"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const channel_utils_1 = require("../utils/channel.utils");
const dzen_service_1 = __importStar(require("./dzen.service"));
const metrics_service_1 = __importDefault(require("./metrics.service"));
const project_access_service_1 = require("./project_access.service");
const DZEN_TYPES = new Set(['dzen', 'zen', 'zen_article']);
class DzenEngagementService {
    async getChannel(projectId, channelId, actorId) {
        await (0, project_access_service_1.requireProjectActorAccess)(projectId, actorId);
        const channel = await db_1.default.socialChannel.findFirst({
            where: { id: channelId, project_id: projectId, is_active: true },
            select: { type: true, config: true }
        });
        if (!channel || !DZEN_TYPES.has(channel.type))
            throw new Error('ACTIVE_DZEN_CHANNEL_NOT_FOUND');
        return (0, channel_utils_1.resolveEffectiveChannelConfig)(channel.type, channel.config);
    }
    async collectPostMetrics(args) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const item = await db_1.default.contentItem.findFirst({
            where: { id: args.contentItemId, project_id: args.projectId, channel_id: args.channelId },
            select: { published_link: true }
        });
        if (!item?.published_link || !(0, dzen_service_1.isDzenPublishedUrl)(item.published_link))
            throw new Error('DZEN_PUBLICATION_URL_NOT_FOUND');
        const collected = await dzen_service_1.default.collectPostMetrics(config, item.published_link);
        const metricNames = ['views', 'likes', 'comments', 'impressions', 'pageViews', 'clicks', 'deepViews', 'shares', 'subscriptions', 'sumViewTimeSec', 'ctr'];
        const values = Object.fromEntries(metricNames.map((name) => {
            const value = collected[name];
            return [name, { value, status: value === null ? 'unknown' : 'observed' }];
        }));
        const day = collected.captured_at.slice(0, 10);
        const checkpoint = args.checkpoint || `dzen_daily_${day}`;
        const observedCount = Object.values(values).filter((metric) => metric.status === 'observed').length;
        const snapshot = await metrics_service_1.default.recordMetricSnapshot({
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
    async searchRelevantPosts(args) {
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const posts = await dzen_service_1.default.searchRelevantPosts(config, args.query.trim(), args.limit, args.minScore);
        return { query: args.query, posts, count: posts.length, source: 'dzen_public_search' };
    }
    async comment(args) {
        if (!(0, dzen_service_1.isDzenPublishedUrl)(args.postUrl))
            throw new Error('INVALID_DZEN_POST_URL');
        const text = args.text.trim();
        const config = await this.getChannel(args.projectId, args.channelId, args.actorId);
        const fingerprint = crypto_1.default.createHash('sha256').update(text).digest('hex');
        if (!args.confirm) {
            const preflight = await dzen_service_1.default.preflightComment(config, args.postUrl);
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
        const keyHash = crypto_1.default.createHash('sha256').update(`${args.channelId}:${args.postUrl}:${args.idempotencyKey}`).digest('hex');
        const settingKey = `dzen_comment:${keyHash}`;
        const existing = await db_1.default.projectSettings.findUnique({
            where: { project_id_key: { project_id: args.projectId, key: settingKey } }
        });
        if (existing) {
            const previous = JSON.parse(existing.value);
            if (previous.text_fingerprint !== fingerprint)
                throw new Error('DZEN_COMMENT_IDEMPOTENCY_CONFLICT');
            return { ...previous, idempotent_replay: true };
        }
        const result = await dzen_service_1.default.comment(config, args.postUrl, text);
        const record = { ...result, text_fingerprint: fingerprint, published_at: new Date().toISOString() };
        await db_1.default.projectSettings.upsert({
            where: { project_id_key: { project_id: args.projectId, key: settingKey } },
            update: { value: JSON.stringify(record) },
            create: { project_id: args.projectId, key: settingKey, value: JSON.stringify(record) }
        });
        return record;
    }
}
exports.default = new DzenEngagementService();
