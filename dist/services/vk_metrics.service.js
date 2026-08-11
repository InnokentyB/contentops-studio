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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VkMetricsService = void 0;
const planner_service_1 = require("./planner.service");
const vk_service_1 = __importStar(require("./vk.service"));
const METRIC_FIELDS = [
    'views',
    'likes',
    'comments',
    'reposts',
    'reach_total',
    'reach_subscribers',
    'reach_viral',
    'reach_ads',
    'link_clicks',
    'group_clicks',
    'group_joins',
    'hides',
    'reports',
    'unsubscribes'
];
function resolveVkConfig(rawConfig) {
    const config = rawConfig?.raw_account || rawConfig || {};
    return {
        vkId: config.vk_id ? String(config.vk_id) : null,
        publishAccessToken: config.publish_access_token || config.api_key || null,
        statsAccessToken: config.analytics_enabled === false ? null : (config.stats_access_token || null)
    };
}
function projectLogicalDate(now, timezone = 'UTC') {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(`${value.year}-${value.month}-${value.day}T00:00:00.000Z`);
}
function snapshotData(result) {
    return {
        owner_id: result.ownerId,
        post_id: result.postId,
        captured_at: new Date(result.retrievedAt),
        wall_status: result.wallStatus,
        reach_status: result.reachStatus,
        views: result.metrics.views,
        likes: result.metrics.likes,
        comments: result.metrics.comments,
        reposts: result.metrics.reposts,
        reach_total: result.metrics.reachTotal,
        reach_subscribers: result.metrics.reachSubscribers,
        reach_viral: result.metrics.reachViral,
        reach_ads: result.metrics.reachAds,
        link_clicks: result.metrics.linkClicks,
        group_clicks: result.metrics.groupClicks,
        group_joins: result.metrics.groupJoins,
        hides: result.metrics.hides,
        reports: result.metrics.reports,
        unsubscribes: result.metrics.unsubscribes,
        provider_error_code: result.providerErrorCode,
        provider_error_message: result.providerErrorMessage,
        raw_payload: result.raw
    };
}
function collectedMetrics(result) {
    return {
        views: result.metrics.views,
        likes: result.metrics.likes,
        comments: result.metrics.comments,
        reposts: result.metrics.reposts,
        reach_total: result.metrics.reachTotal,
        reach_subscribers: result.metrics.reachSubscribers,
        reach_viral: result.metrics.reachViral,
        reach_ads: result.metrics.reachAds,
        link_clicks: result.metrics.linkClicks,
        group_clicks: result.metrics.groupClicks,
        group_joins: result.metrics.groupJoins,
        hides: result.metrics.hides,
        reports: result.metrics.reports,
        unsubscribes: result.metrics.unsubscribes,
        wall_status: result.wallStatus,
        reach_status: result.reachStatus,
        retrieved_at: result.retrievedAt
    };
}
class VkMetricsService {
    async projectTimezone(projectId) {
        const setting = await planner_service_1.prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'timezone' } }
        });
        return setting?.value || 'UTC';
    }
    async persistSnapshot(params) {
        const timezone = await this.projectTimezone(params.item.project_id);
        const logicalDate = projectLogicalDate(params.now, timezone);
        const data = snapshotData(params.result);
        const snapshot = await planner_service_1.prisma.vkMetricSnapshot.upsert({
            where: {
                content_item_id_logical_date_collection_mode: {
                    content_item_id: params.item.id,
                    logical_date: logicalDate,
                    collection_mode: params.mode
                }
            },
            create: {
                project_id: params.item.project_id,
                channel_id: params.item.channel_id,
                content_item_id: params.item.id,
                logical_date: logicalDate,
                collection_mode: params.mode,
                ...data
            },
            update: data
        });
        await planner_service_1.prisma.contentItem.update({
            where: { id: params.item.id },
            data: {
                metrics: {
                    ...(params.item.metrics || {}),
                    vk_identity: {
                        owner_id: params.result.ownerId,
                        post_id: params.result.postId
                    },
                    collected_metrics: collectedMetrics(params.result),
                    metrics_updated_at: params.result.retrievedAt
                }
            }
        });
        return snapshot;
    }
    async collectForContentItem(itemId, projectId, mode = 'manual', now = new Date()) {
        const item = await planner_service_1.prisma.contentItem.findFirst({
            where: { id: itemId, project_id: projectId },
            include: { channel: true }
        });
        if (!item)
            return { found: false, updated: false, reason: 'Publication task not found.' };
        if (item.channel?.type !== 'vk') {
            return { found: true, updated: false, reason: 'Publication task is not connected to VK.' };
        }
        const config = resolveVkConfig(item.channel.config);
        const identity = (0, vk_service_1.parseVkPostIdentity)(item.published_link)
            || (item.metrics?.vk_identity?.owner_id && item.metrics?.vk_identity?.post_id
                ? {
                    ownerId: String(item.metrics.vk_identity.owner_id),
                    postId: String(item.metrics.vk_identity.post_id)
                }
                : null);
        if (!identity)
            return { found: true, updated: false, reason: 'VK post identity is missing.' };
        if (!config.vkId || !config.publishAccessToken) {
            return { found: true, updated: false, reason: 'VK channel is missing vk_id or publish access token.' };
        }
        const result = await vk_service_1.default.collectPostMetrics(identity.ownerId, config.publishAccessToken, identity.postId, config.statsAccessToken);
        const snapshot = await this.persistSnapshot({ item, result, mode, now });
        return {
            found: true,
            updated: result.wallStatus === 'collected' || result.reachStatus === 'collected',
            reason: result.reachStatus === 'unavailable'
                ? 'Public VK metrics were collected. Connect a user statistics token for post reach.'
                : result.providerErrorMessage,
            metrics: collectedMetrics(result),
            snapshot
        };
    }
    async collectDaily(now = new Date(), monitoringDays = 30) {
        const cutoff = new Date(now.getTime() - monitoringDays * 24 * 60 * 60 * 1000);
        const items = await planner_service_1.prisma.contentItem.findMany({
            where: {
                status: 'published',
                published_link: { not: null },
                channel_id: { not: null },
                updated_at: { gte: cutoff },
                channel: { type: 'vk', is_active: true }
            },
            include: { channel: true }
        });
        const groups = new Map();
        for (const item of items) {
            const identity = (0, vk_service_1.parseVkPostIdentity)(item.published_link);
            if (!identity || !item.channel_id)
                continue;
            const group = groups.get(item.channel_id) || [];
            group.push({ item, identity });
            groups.set(item.channel_id, group);
        }
        let updated = 0;
        let attempted = 0;
        for (const group of groups.values()) {
            const channel = group[0]?.item?.channel;
            const config = resolveVkConfig(channel?.config);
            if (!config.vkId || !config.publishAccessToken)
                continue;
            const logicalDates = new Map();
            for (const entry of group) {
                const timezone = await this.projectTimezone(entry.item.project_id);
                logicalDates.set(entry.item.id, projectLogicalDate(now, timezone));
            }
            const existingSnapshots = await planner_service_1.prisma.vkMetricSnapshot.findMany({
                where: {
                    collection_mode: 'automatic',
                    content_item_id: { in: group.map((entry) => entry.item.id) },
                    logical_date: { in: Array.from(logicalDates.values()) }
                },
                select: { content_item_id: true, logical_date: true }
            });
            const existingKeys = new Set(existingSnapshots.map((snapshot) => `${snapshot.content_item_id}:${snapshot.logical_date.toISOString()}`));
            const pendingGroup = group.filter((entry) => {
                const logicalDate = logicalDates.get(entry.item.id);
                return logicalDate && !existingKeys.has(`${entry.item.id}:${logicalDate.toISOString()}`);
            });
            if (!pendingGroup.length)
                continue;
            const results = await vk_service_1.default.collectPostsMetrics(config.vkId, config.publishAccessToken, pendingGroup.map((entry) => entry.identity.postId), config.statsAccessToken);
            const resultByPostId = new Map(results.map((result) => [result.postId, result]));
            for (const entry of pendingGroup) {
                const result = resultByPostId.get(entry.identity.postId);
                if (!result)
                    continue;
                attempted++;
                await this.persistSnapshot({ item: entry.item, result, mode: 'automatic', now });
                if (result.wallStatus === 'collected' || result.reachStatus === 'collected')
                    updated++;
            }
        }
        return { attempted, updated };
    }
    async getHistory(itemId, projectId, from, to) {
        const item = await planner_service_1.prisma.contentItem.findFirst({ where: { id: itemId, project_id: projectId }, select: { id: true } });
        if (!item)
            return null;
        return planner_service_1.prisma.vkMetricSnapshot.findMany({
            where: {
                content_item_id: itemId,
                project_id: projectId,
                ...(from || to ? {
                    logical_date: {
                        ...(from ? { gte: from } : {}),
                        ...(to ? { lte: to } : {})
                    }
                } : {})
            },
            orderBy: [{ logical_date: 'asc' }, { captured_at: 'asc' }]
        });
    }
    async getWeeklyDelta(itemId, projectId, from, to) {
        const item = await planner_service_1.prisma.contentItem.findFirst({ where: { id: itemId, project_id: projectId }, select: { id: true } });
        if (!item)
            return null;
        const [start, end] = await Promise.all([
            planner_service_1.prisma.vkMetricSnapshot.findFirst({
                where: { content_item_id: itemId, project_id: projectId, logical_date: { lt: from } },
                orderBy: [{ logical_date: 'desc' }, { captured_at: 'desc' }]
            }),
            planner_service_1.prisma.vkMetricSnapshot.findFirst({
                where: { content_item_id: itemId, project_id: projectId, logical_date: { lte: to } },
                orderBy: [{ logical_date: 'desc' }, { captured_at: 'desc' }]
            })
        ]);
        const delta = {};
        for (const field of METRIC_FIELDS) {
            delta[field] = (0, vk_service_1.calculateVkMetricDelta)(start?.[field], end?.[field]);
        }
        return {
            from: from.toISOString(),
            to: to.toISOString(),
            complete: Boolean(start && end),
            start,
            end,
            delta,
            providerAdjustment: Object.values(delta).some((value) => typeof value === 'number' && value < 0)
        };
    }
    async exportProject(projectId, from, to) {
        return planner_service_1.prisma.vkMetricSnapshot.findMany({
            where: {
                project_id: projectId,
                ...(from || to ? {
                    logical_date: {
                        ...(from ? { gte: from } : {}),
                        ...(to ? { lte: to } : {})
                    }
                } : {})
            },
            orderBy: [{ logical_date: 'asc' }, { content_item_id: 'asc' }]
        });
    }
}
exports.VkMetricsService = VkMetricsService;
exports.default = new VkMetricsService();
