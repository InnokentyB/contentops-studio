import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import plannerService from '../../services/planner.service';
import v2Orchestrator from '../../services/v2_orchestrator.service';
import generatorService from '../../services/generator.service';
import { logEgressDiagnostic } from '../../utils/egress_diagnostics';

interface IdParams {
    id: string;
}

interface PlanWeekBody {
    themeHint: string;
    startDate?: string;
}

interface PlanQuarterBody {
    goalHint?: string;
    startDate?: string;
    plannedChannels?: unknown;
}

export default async function v2OrchestratorRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/api/v2/weeks', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const publicationTaskWhere: Prisma.ContentItemWhereInput = {
            project_id: projectId,
            week_package_id: { not: null },
            type: { not: 'week_theme' },
            OR: [
                { assets: { not: Prisma.AnyNull } },
                { item_key: { startsWith: 'week-topic:' } }
            ]
        };
        const [weeks, publicationTaskCounts] = await Promise.all([
            prisma.weekPackage.findMany({
                where: { project_id: projectId },
                orderBy: { week_start: 'desc' },
                include: { _count: { select: { content_items: true } } }
            }),
            prisma.contentItem.groupBy({
                by: ['week_package_id'],
                where: publicationTaskWhere,
                _count: { _all: true }
            })
        ]);
        const countByWeekId = new Map(
            publicationTaskCounts.map((entry) => [entry.week_package_id, entry._count._all])
        );
        return weeks.map((week) => ({
            ...week,
            publication_task_count: countByWeekId.get(week.id) || 0
        }));
    });

    fastify.get('/api/v2/weeks/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        let week = await prisma.weekPackage.findUnique({
            where: { id: parseInt(id, 10), project_id: projectId },
            include: {
                content_items: {
                    orderBy: { schedule_at: 'asc' }
                }
            }
        });

        if (!week) {
            // Check if it is a V1 week ID
            const v1Week = await prisma.week.findFirst({
                where: { id: parseInt(id, 10), project_id: projectId }
            });
            if (v1Week) {
                const matchingWeekPackage = await prisma.weekPackage.findFirst({
                    where: {
                        project_id: projectId,
                        week_start: {
                            gte: v1Week.week_start,
                            lte: v1Week.week_end
                        }
                    },
                    include: {
                        content_items: {
                            orderBy: { schedule_at: 'asc' }
                        }
                    }
                });
                if (matchingWeekPackage) {
                    week = matchingWeekPackage;
                }
            }
        }

        if (!week) return reply.code(404).send({ error: 'V2 WeekPackage not found' });
        return week;
    });

    fastify.post('/api/v2/weeks/:id/convert-to-v1', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;

        try {
            const result = await plannerService.convertWeekPackageToV1(projectId, parseInt(id, 10));

            logEgressDiagnostic('weeks.convert_to_v1', {
                projectId,
                weekPackageId: parseInt(id, 10),
                weekId: result.weekId,
                reused: result.reused
            });

            return {
                success: true,
                message: result.reused ? 'V1 Week already exists for these dates.' : 'V1 Week created successfully.',
                weekId: result.weekId
            };
        } catch (error: unknown) {
            const err = error as Error;
            if (err.message === 'V2 WeekPackage not found') {
                return reply.code(404).send({ error: err.message });
            }
            return reply.code(400).send({ error: err.message });
        }
    });

    fastify.post('/api/v2/plan-week', async (request: FastifyRequest<{ Body: PlanWeekBody }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { themeHint, startDate } = request.body || {};

        let weekStart = new Date();
        if (startDate) {
            weekStart = new Date(startDate);
        } else {
            const dayOfWeek = weekStart.getDay();
            const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
            weekStart.setDate(weekStart.getDate() + daysUntilNextMonday);
        }
        weekStart.setUTCHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setUTCHours(23, 59, 59, 999);

        try {
            const wp = await v2Orchestrator.planWeek(projectId, weekStart, weekEnd, themeHint || '');
            await v2Orchestrator.architectDistribution(wp.id);
            const validation = await v2Orchestrator.validateContinuity(wp.id);
            if (!validation.valid) {
                console.warn(`[NCC] Validation failed for WP ${wp.id}: ${validation.critique}`);
            }

            return { success: true, weekPackageId: wp.id, validation };
        } catch (e: unknown) {
            const err = e as Error;
            console.error('[API] Error in V2 plan-week:', err);
            return reply.code(500).send({ error: 'Failed to complete V2 planning', details: err.message });
        }
    });

    fastify.post('/api/v2/approve-week/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;
        const wp = await prisma.weekPackage.findUnique({ where: { id: parseInt(id, 10), project_id: projectId } });
        if (!wp) return reply.code(404).send({ error: 'WeekPackage not found' });

        const updated = await prisma.weekPackage.update({
            where: { id: wp.id },
            data: { approval_status: 'approved' }
        });

        return { success: true, status: updated.approval_status };
    });

    fastify.post('/api/v2/architect-week/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { id } = request.params;

        try {
            const items = await v2Orchestrator.architectDistribution(parseInt(id, 10));
            return { success: true, count: items.length };
        } catch (e: unknown) {
            const err = e as Error;
            return reply.code(500).send({ error: err.message || 'Failed to architect week' });
        }
    });

    fastify.post('/api/v2/plan-quarter', async (request: FastifyRequest<{ Body: PlanQuarterBody }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { goalHint, startDate, plannedChannels } = request.body || {};
        const dStart = startDate ? new Date(startDate) : new Date();

        try {
            const result = await v2Orchestrator.planQuarter(projectId, dStart, goalHint, plannedChannels);

            for (const month of result.monthArcs) {
                await v2Orchestrator.planMonth(month.id);
            }

            return { success: true, quarterId: result.quarterPlan.id };
        } catch (e: unknown) {
            const err = e as Error;
            return reply.code(500).send({ error: err.message || 'Failed to plan quarter' });
        }
    });

    fastify.get('/api/v2/quarters', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const quarters = await prisma.quarterPlan.findMany({
            where: { project_id: projectId },
            orderBy: { quarter_start: 'desc' },
            include: {
                month_arcs: {
                    include: {
                        week_packages: true
                    }
                }
            }
        });
        return quarters;
    });

    fastify.post('/api/v2/factory-sweep', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        try {
            const itemsToProcess = await prisma.contentItem.findMany({
                where: {
                    project_id: projectId,
                    status: 'planned',
                    week_package: { approval_status: 'approved' }
                },
                take: 2
            });

            const results = [];
            for (const item of itemsToProcess) {
                try {
                    await generatorService.generateContentItemText(item.id);
                    results.push({ id: item.id, status: 'drafted' });
                } catch (e: unknown) {
                    const err = e as Error;
                    await prisma.contentItem.update({ where: { id: item.id }, data: { status: 'failed' } });
                    results.push({ id: item.id, status: 'failed', error: err.message });
                }
            }
            return { processed: results.length, results };
        } catch (e: unknown) {
            const err = e as Error;
            return reply.code(500).send({ error: 'Failed during factory sweep', details: err.message });
        }
    });
}
