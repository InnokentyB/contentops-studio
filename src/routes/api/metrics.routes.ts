import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../../db';
import metricsService from '../../services/metrics.service';
import vkMetricsService from '../../services/vk_metrics.service';
import publicationFactService from '../../services/publication_fact.service';
import { jsonBytes, logEgressDiagnostic } from '../../utils/egress_diagnostics';
import { csvCell, parseMetricsDate } from './helpers';

interface IdParams {
    id: string;
}

export default async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/api/metric-checkpoints', async (request: FastifyRequest<{
        Querystring: { status?: string; dueBefore?: string; channelId?: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const userId = (request as unknown as { user?: { id: number } }).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        const query = request.query;
        try {
            return {
                checkpoints: await publicationFactService.listCheckpoints({
                    projectId,
                    actorId: `user:${userId}`,
                    status: query.status,
                    dueBefore: query.dueBefore,
                    channelId: query.channelId ? Number(query.channelId) : undefined
                })
            };
        } catch (error: unknown) {
            const err = error as Error;
            return reply.code(400).send({ error: String(err?.message || 'METRIC_CHECKPOINTS_FAILED') });
        }
    });

    fastify.put('/api/publication-tasks/:id/metric-checkpoints/:checkpoint', async (request: FastifyRequest<{
        Params: { id: string; checkpoint: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const userId = (request as unknown as { user?: { id: number } }).user?.id;
        if (!projectId || !userId) return reply.code(400).send({ error: 'Project and user are required' });
        const { id, checkpoint } = request.params;
        const body = request.body as any;
        try {
            return await metricsService.recordMetricSnapshot({
                ...body,
                projectId,
                actorId: `user:${userId}`,
                contentItemId: Number(id),
                checkpoint
            });
        } catch (error: unknown) {
            const err = error as Error;
            return reply.code(400).send({ error: String(err?.message || 'METRIC_SNAPSHOT_FAILED') });
        }
    });

    fastify.post('/api/publication-tasks/:id/record-metrics', async (request: FastifyRequest<{
        Params: IdParams;
        Body: { metrics?: Record<string, any> };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const { metrics } = request.body || {};

        const item = await prisma.contentItem.findFirst({
            where: { id: parseInt(id, 10), project_id: projectId }
        });

        if (!item) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        const updated = await prisma.contentItem.update({
            where: { id: item.id },
            data: {
                metrics: {
                    ...((item.metrics as any) || {}),
                    collected_metrics: metrics || {},
                    metrics_updated_at: new Date().toISOString()
                } as any
            }
        });

        logEgressDiagnostic('publication_tasks.record_metrics', {
            projectId,
            taskId: updated.id,
            metricsBytes: jsonBytes(metrics || {}),
            responseBytes: jsonBytes(updated)
        });

        return updated;
    });

    fastify.post('/api/publication-tasks/:id/collect-metrics', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const result = await metricsService.collectMetricsForContentItem(parseInt(id, 10), projectId);

        if (!result.found) {
            return reply.code(404).send({ error: 'Publication task not found' });
        }

        logEgressDiagnostic('publication_tasks.collect_metrics', {
            projectId,
            taskId: parseInt(id, 10),
            found: result.found,
            responseBytes: jsonBytes(result)
        });

        return result;
    });

    fastify.get('/api/publication-tasks/:id/metrics-history', async (request: FastifyRequest<{
        Params: IdParams;
        Querystring: { from?: string; to?: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { from, to } = request.query;
        try {
            const history = await vkMetricsService.getHistory(
                parseInt(id, 10),
                projectId,
                parseMetricsDate(from, 'from'),
                parseMetricsDate(to, 'to')
            );
            if (!history) return reply.code(404).send({ error: 'Publication task not found' });
            return { snapshots: history };
        } catch (error: unknown) {
            const err = error as Error;
            return reply.code(400).send({ error: err.message || 'Invalid metrics history request' });
        }
    });

    fastify.get('/api/publication-tasks/:id/metrics-weekly', async (request: FastifyRequest<{
        Params: IdParams;
        Querystring: { from?: string; to?: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const { id } = request.params;
        const { from, to } = request.query;
        if (!from || !to) return reply.code(400).send({ error: 'from and to are required' });
        try {
            const report = await vkMetricsService.getWeeklyDelta(
                parseInt(id, 10),
                projectId,
                parseMetricsDate(from, 'from')!,
                parseMetricsDate(to, 'to')!
            );
            if (!report) return reply.code(404).send({ error: 'Publication task not found' });
            return report;
        } catch (error: unknown) {
            const err = error as Error;
            return reply.code(400).send({ error: err.message || 'Invalid weekly metrics request' });
        }
    });

    fastify.get('/api/vk-metrics/export', async (request: FastifyRequest<{
        Querystring: { from?: string; to?: string; format?: string };
    }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });
        const { from, to, format = 'json' } = request.query;
        if (!['json', 'csv'].includes(format)) {
            return reply.code(400).send({ error: 'format must be json or csv' });
        }
        try {
            const snapshots = await vkMetricsService.exportProject(
                projectId,
                parseMetricsDate(from, 'from'),
                parseMetricsDate(to, 'to')
            );
            if (format === 'json') return { snapshots };

            const columns = [
                'content_item_id', 'channel_id', 'owner_id', 'post_id', 'logical_date', 'captured_at',
                'wall_status', 'reach_status', 'views', 'likes', 'comments', 'reposts', 'reach_total',
                'reach_subscribers', 'reach_viral', 'reach_ads', 'link_clicks', 'group_clicks', 'group_joins',
                'hides', 'reports', 'unsubscribes', 'provider_error_code'
            ] as const;
            const rows = [
                columns.join(','),
                ...snapshots.map((snapshot) => columns.map((column) => csvCell(snapshot[column])).join(','))
            ];
            reply.header('content-type', 'text/csv; charset=utf-8');
            reply.header('content-disposition', `attachment; filename="vk-metrics-${projectId}.csv"`);
            return rows.join('\n');
        } catch (error: unknown) {
            const err = error as Error;
            return reply.code(400).send({ error: err.message || 'Invalid metrics export request' });
        }
    });
}
