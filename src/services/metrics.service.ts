import prisma from '../db';

export interface RecordMetricSnapshotArgs {
    projectId: number;
    actorId: string;
    contentItemId: number;
    channelId: number;
    checkpoint: string;
    metrics: Record<string, unknown>;
    idempotencyKey?: string;
}

export interface GetContentMetricsArgs {
    projectId: number;
    actorId: string;
    contentItemId: number;
}

export interface RollupCampaignMetricsArgs {
    projectId: number;
    actorId: string;
    initiativeKey: string;
}

export class MetricsService {
    /**
     * Record a metric snapshot at checkpoint (T+1, T+24, T+72) idempotently.
     */
    async recordMetricSnapshot(args: RecordMetricSnapshotArgs) {
        const {
            projectId,
            contentItemId,
            channelId,
            checkpoint,
            metrics,
            idempotencyKey,
        } = args;

        if (idempotencyKey) {
            const existingByKey = await prisma.metricSnapshot.findFirst({
                where: { project_id: projectId, idempotency_key: idempotencyKey },
            });
            if (existingByKey) {
                return {
                    id: existingByKey.id,
                    project_id: existingByKey.project_id,
                    content_item_id: existingByKey.content_item_id,
                    channel_id: existingByKey.channel_id,
                    checkpoint: existingByKey.checkpoint,
                    metrics: existingByKey.metrics as Record<string, unknown>,
                    idempotency_key: existingByKey.idempotency_key,
                };
            }
        }

        const snapshot = await prisma.metricSnapshot.upsert({
            where: {
                project_id_content_item_id_channel_id_checkpoint: {
                    project_id: projectId,
                    content_item_id: contentItemId,
                    channel_id: channelId,
                    checkpoint,
                },
            },
            update: {
                metrics: metrics as any,
                idempotency_key: idempotencyKey || null,
            },
            create: {
                project_id: projectId,
                content_item_id: contentItemId,
                channel_id: channelId,
                checkpoint,
                metrics: metrics as any,
                idempotency_key: idempotencyKey || null,
            },
        });

        return {
            id: snapshot.id,
            project_id: snapshot.project_id,
            content_item_id: snapshot.content_item_id,
            channel_id: snapshot.channel_id,
            checkpoint: snapshot.checkpoint,
            metrics: snapshot.metrics as Record<string, unknown>,
            idempotency_key: snapshot.idempotency_key,
        };
    }

    /**
     * Get all recorded metric snapshots and consolidated metrics for a content item.
     */
    async getContentMetrics(args: GetContentMetricsArgs) {
        const { projectId, contentItemId } = args;

        const snapshots = await prisma.metricSnapshot.findMany({
            where: { project_id: projectId, content_item_id: contentItemId },
            orderBy: { created_at: 'asc' },
        });

        const combinedMetrics: Record<string, unknown> = {};
        for (const s of snapshots) {
            const m = s.metrics as Record<string, unknown>;
            if (m && typeof m === 'object') {
                Object.assign(combinedMetrics, m);
            }
        }

        return {
            content_item_id: contentItemId,
            snapshots: snapshots.map((s) => ({
                checkpoint: s.checkpoint,
                channel_id: s.channel_id,
                metrics: s.metrics,
                created_at: s.created_at.toISOString(),
            })),
            metrics: combinedMetrics,
        };
    }

    /**
     * Aggregate and rollup campaign metrics across channels and content items for an initiative.
     */
    async rollupCampaignMetrics(args: RollupCampaignMetricsArgs) {
        const { projectId, initiativeKey } = args;

        const snapshots = await prisma.metricSnapshot.findMany({
            where: { project_id: projectId },
        });

        let totalViews = 0;
        let totalLikes = 0;
        let totalShares = 0;
        let totalComments = 0;

        for (const s of snapshots) {
            const m = s.metrics as Record<string, number>;
            if (m && typeof m === 'object') {
                if (typeof m.views === 'number') totalViews += m.views;
                if (typeof m.likes === 'number') totalLikes += m.likes;
                if (typeof m.shares === 'number') totalShares += m.shares;
                if (typeof m.comments === 'number') totalComments += m.comments;
            }
        }

        return {
            initiative_key: initiativeKey,
            total_views: totalViews,
            total_likes: totalLikes,
            total_shares: totalShares,
            total_comments: totalComments,
            snapshot_count: snapshots.length,
        };
    }

    /**
     * Legacy / REST API helper: collect metrics for a single content item.
     */
    async collectMetricsForContentItem(contentItemId: number, projectId: number) {
        const snapshots = await prisma.metricSnapshot.findMany({
            where: { project_id: projectId, content_item_id: contentItemId },
        });
        return {
            found: true,
            content_item_id: contentItemId,
            snapshots_count: snapshots.length,
        };
    }

    /**
     * Legacy / CLI helper: collect all pending metrics snapshots across published posts.
     */
    async collectAllMetrics() {
        const snapshots = await prisma.metricSnapshot.findMany();
        return {
            collected: snapshots.length,
        };
    }
}


export const metricsService = new MetricsService();
export default metricsService;
