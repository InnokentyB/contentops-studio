"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsService = void 0;
const db_1 = __importDefault(require("../db"));
const project_access_service_1 = require("./project_access.service");
const publication_fact_service_1 = require("./publication_fact.service");
function parseDate(value) {
    if (!value)
        return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        throw new Error('INVALID_METRIC_TIMESTAMP');
    return parsed;
}
function isPayloadV1(value) {
    return value?.schema_version === 1 && Boolean(value.values) && typeof value.values === 'object';
}
function validatePayload(payload) {
    if (!isPayloadV1(payload))
        return;
    const allowed = new Set(['observed', 'unknown', 'not_supported', 'invalid']);
    for (const [name, metric] of Object.entries(payload.values)) {
        if (!metric || typeof metric !== 'object' || !allowed.has(metric.status)) {
            throw new Error(`INVALID_METRIC_STATUS:${name}`);
        }
        if (metric.status === 'observed' && typeof metric.value !== 'number') {
            throw new Error(`OBSERVED_METRIC_VALUE_REQUIRED:${name}`);
        }
        if (metric.status !== 'observed' && metric.value !== null) {
            throw new Error(`NON_OBSERVED_METRIC_MUST_BE_NULL:${name}`);
        }
    }
}
function serializeSnapshot(snapshot) {
    return {
        id: snapshot.id,
        project_id: snapshot.project_id,
        content_item_id: snapshot.content_item_id,
        channel_id: snapshot.channel_id,
        checkpoint: snapshot.checkpoint,
        scheduled_for: snapshot.scheduled_for?.toISOString?.() || null,
        captured_at: snapshot.captured_at?.toISOString?.() || null,
        collection_mode: snapshot.collection_mode,
        source: snapshot.source,
        collection_status: snapshot.collection_status,
        late: snapshot.late,
        metrics: snapshot.metrics,
        evidence_ref: snapshot.evidence_ref,
        error_code: snapshot.error_code,
        error_message: snapshot.error_message,
        idempotency_key: snapshot.idempotency_key,
        created_at: snapshot.created_at?.toISOString?.() || null
    };
}
function snapshotTime(snapshot) {
    return snapshot.captured_at?.getTime?.() || snapshot.scheduled_for?.getTime?.() || snapshot.updated_at?.getTime?.() || 0;
}
function latestMetrics(snapshots) {
    const latest = {};
    const legacy = {};
    for (const snapshot of [...snapshots].sort((a, b) => snapshotTime(a) - snapshotTime(b))) {
        const payload = snapshot.metrics;
        if (isPayloadV1(payload)) {
            for (const [name, metric] of Object.entries(payload.values)) {
                if (metric.status === 'observed' || !(name in latest)) {
                    latest[name] = {
                        ...metric,
                        checkpoint: snapshot.checkpoint,
                        captured_at: snapshot.captured_at?.toISOString?.() || null,
                        source: snapshot.source
                    };
                }
            }
        }
        else if (payload && typeof payload === 'object') {
            Object.assign(legacy, payload);
        }
    }
    return { latest, legacy };
}
class MetricsService {
    async recordMetricSnapshot(args) {
        await (0, project_access_service_1.requireProjectActorAccess)(args.projectId, args.actorId);
        validatePayload(args.metrics);
        const item = await db_1.default.contentItem.findFirst({
            where: { id: args.contentItemId, project_id: args.projectId },
            select: { id: true, channel_id: true }
        });
        if (!item || item.channel_id !== args.channelId)
            throw new Error('CONTENT_ITEM_NOT_FOUND');
        if (args.idempotencyKey) {
            const existingByKey = await db_1.default.metricSnapshot.findFirst({
                where: { project_id: args.projectId, idempotency_key: args.idempotencyKey }
            });
            if (existingByKey)
                return serializeSnapshot(existingByKey);
        }
        const capturedAt = parseDate(args.capturedAt) || new Date();
        const scheduledFor = parseDate(args.scheduledFor);
        const existing = await db_1.default.metricSnapshot.findUnique({
            where: {
                project_id_content_item_id_channel_id_checkpoint: {
                    project_id: args.projectId,
                    content_item_id: args.contentItemId,
                    channel_id: args.channelId,
                    checkpoint: args.checkpoint
                }
            }
        });
        const dueAt = scheduledFor || existing?.scheduled_for || null;
        const late = Boolean(dueAt && capturedAt.getTime() > dueAt.getTime());
        const data = {
            metrics: args.metrics,
            scheduled_for: dueAt,
            captured_at: capturedAt,
            collection_mode: args.collectionMode || existing?.collection_mode || 'manual',
            source: args.source || existing?.source || 'manual',
            collection_status: args.collectionStatus || 'collected',
            evidence_ref: args.evidenceRef || null,
            error_code: args.errorCode || null,
            error_message: args.errorMessage?.slice(0, 500) || null,
            late,
            window_start: parseDate(args.windowStart),
            window_end: parseDate(args.windowEnd),
            idempotency_key: args.idempotencyKey || null
        };
        const snapshot = await db_1.default.metricSnapshot.upsert({
            where: {
                project_id_content_item_id_channel_id_checkpoint: {
                    project_id: args.projectId,
                    content_item_id: args.contentItemId,
                    channel_id: args.channelId,
                    checkpoint: args.checkpoint
                }
            },
            update: data,
            create: {
                project_id: args.projectId,
                content_item_id: args.contentItemId,
                channel_id: args.channelId,
                checkpoint: args.checkpoint,
                ...data
            }
        });
        return serializeSnapshot(snapshot);
    }
    async getContentMetrics(args) {
        await (0, project_access_service_1.requireProjectActorAccess)(args.projectId, args.actorId);
        const item = await db_1.default.contentItem.findFirst({
            where: { id: args.contentItemId, project_id: args.projectId },
            include: { publication_fact: true }
        });
        if (!item)
            throw new Error('CONTENT_ITEM_NOT_FOUND');
        const snapshots = await db_1.default.metricSnapshot.findMany({
            where: { project_id: args.projectId, content_item_id: args.contentItemId },
            orderBy: [{ scheduled_for: 'asc' }, { created_at: 'asc' }]
        });
        const { latest, legacy } = latestMetrics(snapshots);
        return {
            content_item_id: args.contentItemId,
            publication_fact: item.publication_fact || null,
            snapshots: snapshots.map(serializeSnapshot),
            latest_by_metric: latest,
            metrics: legacy,
            coverage: {
                expected: snapshots.length,
                collected: snapshots.filter((entry) => entry.collection_status === 'collected').length,
                partial: snapshots.filter((entry) => entry.collection_status === 'partial').length,
                overdue: snapshots.filter((entry) => entry.collection_status === 'overdue').length
            }
        };
    }
    async rollupCampaignMetrics(args) {
        await (0, project_access_service_1.requireProjectActorAccess)(args.projectId, args.actorId);
        const items = await db_1.default.contentItem.findMany({
            where: { project_id: args.projectId },
            include: { publication_fact: true, metric_snapshots: true }
        });
        const totals = { views: 0, likes: 0, shares: 0, comments: 0 };
        let included = 0;
        let excluded = 0;
        for (const item of items) {
            const legacyOutcome = item.metrics?.publication_outcome || item.quality_report?.publication_outcome;
            const published = item.publication_fact
                ? (0, publication_fact_service_1.isActuallyPublished)(item.publication_fact)
                : (item.status === 'published' || Boolean(item.published_link)) && !['removed', 'blocked', 'restricted'].includes(legacyOutcome);
            if (!published) {
                excluded += 1;
                continue;
            }
            included += 1;
            const { latest, legacy } = latestMetrics(item.metric_snapshots);
            const aliases = {
                views: ['views'], likes: ['likes', 'reactions'], shares: ['shares', 'reposts'], comments: ['comments']
            };
            for (const [target, names] of Object.entries(aliases)) {
                const observed = names.map((name) => latest[name]).find((entry) => entry?.status === 'observed');
                const legacyValue = names.map((name) => legacy[name]).find((value) => typeof value === 'number');
                const value = observed?.value ?? legacyValue;
                if (typeof value === 'number')
                    totals[target] += value;
            }
        }
        return {
            initiative_key: args.initiativeKey,
            total_views: totals.views,
            total_likes: totals.likes,
            total_shares: totals.shares,
            total_comments: totals.comments,
            publication_count: included,
            excluded_count: excluded
        };
    }
    async collectMetricsForContentItem(contentItemId, projectId) {
        const snapshots = await db_1.default.metricSnapshot.findMany({ where: { project_id: projectId, content_item_id: contentItemId } });
        return { found: true, content_item_id: contentItemId, snapshots_count: snapshots.length };
    }
    async collectAllMetrics() {
        return { collected: await db_1.default.metricSnapshot.count() };
    }
}
exports.MetricsService = MetricsService;
exports.default = new MetricsService();
