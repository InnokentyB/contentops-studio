import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import plannerService from '../../services/planner.service';
import { getAuthorizedWeek } from './helpers';
import { UpdateWeekSchema, GenerateTopicsSchema } from '../../schemas/routes.schema';
import fs from 'fs';

interface IdParams {
    id: string;
}

interface CreateWeekBody {
    theme: string;
    startDate?: string;
    channelId?: number;
}

export default async function weeksRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/api/weeks', async (request: FastifyRequest, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const weeks = await prisma.week.findMany({
            where: { project_id: projectId },
            orderBy: { week_start: 'desc' },
            include: { _count: { select: { posts: true } } }
        });
        return weeks;
    });

    fastify.post('/api/weeks', async (request: FastifyRequest<{ Body: CreateWeekBody }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { theme, startDate, channelId } = request.body;

        let start: Date;
        let end: Date;
        if (startDate) {
            const date = new Date(startDate);
            const range = await plannerService.getWeekRangeForDate(date);
            start = range.start;
            end = range.end;
        } else {
            const range = await plannerService.getNextWeekRange();
            start = range.start;
            end = range.end;
        }

        try {
            const week = await plannerService.createWeek(projectId, theme, start, end);
            // Default: All 7 days (14 slots)
            await plannerService.generateSlots(week.id, projectId, start, 14, 0, channelId);
            return week;
        } catch (e: unknown) {
            const error = e as { code?: string; message?: string };
            // P2002 is Prisma Unique Constraint Violation
            if (error.code === 'P2002') {
                console.log(`[API] Week already exists for project ${projectId} and start ${start}. Returning existing.`);
                const existing = await prisma.week.findFirst({
                    where: {
                        project_id: projectId,
                        week_start: start,
                        week_end: end
                    },
                    include: { _count: { select: { posts: true } } }
                });
                return existing;
            }
            console.error('[API] Error creating week:', error);
            return reply.code(500).send({ error: 'Failed to create week', details: error.message });
        }
    });

    fastify.get('/api/weeks/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        try {
            const { id } = request.params;
            const user = (request as unknown as { user?: { id: number } }).user;
            const week = await getAuthorizedWeek(parseInt(id, 10), user?.id ?? 0, 'viewer', true);

            if (!week) {
                return reply.code(404).send({ error: 'Week not found' });
            }

            // Get topics if in topics_generated status
            const topics = null;
            if (week.status === 'topics_generated') {
                console.log('Week status is topics_generated, looking for run...');
                const run = await prisma.agentRun.findFirst({
                    where: { input: `Theme: ${week.theme}` },
                    orderBy: { created_at: 'desc' },
                    include: { iterations: true }
                });
                if (run) {
                    console.log('Run found:', run.id);
                }
            }

            console.log('Returning week:', week.id);

            // Sanitize BigInt for Fastify
            const serializedPosts = (week.posts || []).map((p: { approval_message_id?: bigint | number | string | null; [key: string]: unknown }) => ({
                ...p,
                approval_message_id: p.approval_message_id ? p.approval_message_id.toString() : null
            }));

            return { ...week, posts: serializedPosts, topics };
        } catch (e: unknown) {
            const error = e as Error;
            console.error('Error in GET /api/weeks/:id:', error);
            fs.promises.appendFile('server_error.log', `[${new Date().toISOString()}] Error in GET /weeks/${request.params.id}: ${error.message}\n${error.stack}\n\n`).catch(() => {});
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.put('/api/weeks/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const week = await getAuthorizedWeek(parseInt(id, 10), user?.id ?? 0, 'editor');
        if (!week) {
            return reply.code(404).send({ error: 'Week not found' });
        }
        const parseResult = UpdateWeekSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.code(400).send({ error: parseResult.error.message });
        }
        const data = parseResult.data;

        const updated = await prisma.week.update({
            where: { id: parseInt(id, 10) },
            data: data as Prisma.WeekUpdateInput
        });

        return updated;
    });

    fastify.delete('/api/weeks/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const week = await getAuthorizedWeek(parseInt(id, 10), user?.id ?? 0, 'editor');
        if (!week) {
            return reply.code(404).send({ error: 'Week not found' });
        }
        await prisma.week.delete({ where: { id: parseInt(id, 10) } });
        return { success: true };
    });

    fastify.post('/api/weeks/:id/generate-topics', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        try {
            const projectId = (request as unknown as { projectId?: number }).projectId;
            console.log('[API] Generate Topics Request:', {
                projectId,
                params: request.params,
                headers_x_project_id: request.headers['x-project-id']
            });

            if (!projectId) {
                console.error('[API] Missing Project ID');
                return reply.code(400).send({ error: 'Project ID required' });
            }

            const { id } = request.params;
            const parseResult = GenerateTopicsSchema.safeParse(request.body || {});
            if (!parseResult.success) {
                return reply.code(400).send({ error: parseResult.error.message });
            }
            const { promptPresetId, overwrite } = parseResult.data;

            const week = await prisma.week.findUnique({
                where: { id: parseInt(id, 10) }
            });

            if (!week || week.project_id !== projectId) {
                return reply.code(404).send({ error: 'Week not found' });
            }

            if (overwrite) {
                console.log(`[API] Overwriting topics for week ${id}`);
                await prisma.post.deleteMany({
                    where: {
                        week_id: week.id,
                        status: { in: ['planned', 'topics_generated'] }
                    }
                });
            }

            let promptOverride: string | undefined;
            if (promptPresetId) {
                const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
                if (preset) promptOverride = preset.prompt_text;
            }

            const existingPosts = await prisma.post.findMany({
                where: { week_id: week.id, status: { not: 'planned' } },
                select: { topic: true }
            });
            const existingCount = existingPosts.length;
            const existingTopics = existingPosts.map((p) => p.topic || '').filter(Boolean);

            let countToGenerate = 0;
            if (existingCount < 14) {
                countToGenerate = 14 - existingCount;
            } else {
                return reply.code(400).send({ error: 'Maximum topics (14) already reached' });
            }

            if (countToGenerate <= 0) {
                return reply.code(400).send({ error: 'No topics needed or max reached' });
            }

            const { topicsQueue } = require('../../queue');
            await topicsQueue.add('generate-topics', {
                projectId,
                weekId: week.id,
                promptOverride,
                countToGenerate,
                existingCount,
                existingTopics
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }
            });

            return reply.code(202).send({ success: true, message: 'Topics generation queued in background' });
        } catch (error: unknown) {
            const err = error as Error;
            console.error('[API Error] Generate Topics Failed API setup:', err);
            const logEntry = `[${new Date().toISOString()}] Error in /generate-topics API: ${err.message}\nStack: ${err.stack}\n\n`;
            fs.promises.appendFile('server_error.log', logEntry).catch(() => {});
            return reply.code(500).send({ error: 'Internal Server Error', details: err.message });
        }
    });

    fastify.post('/api/weeks/:id/approve-topics', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const weekId = parseInt(id, 10);

        await prisma.post.updateMany({
            where: {
                week_id: weekId,
                status: 'topics_generated'
            },
            data: {
                status: 'topics_approved'
            }
        });

        await plannerService.updateWeekStatus(weekId, 'topics_approved');
        return { success: true };
    });

    fastify.post('/api/weeks/:id/generate-posts', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const { id } = request.params;
        const week = await prisma.week.findUnique({
            where: { id: parseInt(id, 10), project_id: projectId },
            include: { posts: true }
        });

        if (!week) {
            return reply.code(404).send({ error: 'Week not found' });
        }

        await plannerService.updateWeekStatus(week.id, 'generating');

        const { postsQueue } = require('../../queue');
        for (const post of week.posts) {
            if (!post.topic) continue;

            await prisma.post.update({
                where: { id: post.id },
                data: { status: 'generating' }
            });

            await postsQueue.add('generate-post', {
                projectId,
                theme: week.theme,
                topic: post.topic,
                postId: post.id,
                isBatch: true
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 10000 }
            });
        }

        return reply.code(202).send({ success: true, message: 'Generation queued' });
    });

    fastify.post('/api/weeks/:id/generate-sequential', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const projectId = (request as unknown as { projectId?: number }).projectId;
        const { id } = request.params;

        const week = await prisma.week.findUnique({
            where: { id: parseInt(id, 10) }
        });

        if (!week) return reply.code(404).send({ error: 'Week not found' });

        (async () => {
            const writer = require('../../services/sequential_writer.service').default;
            try {
                await writer.generateWeekPosts(projectId, week.id);
            } catch (e) {
                console.error('Sequential generation failed', e);
            }
        })();

        return { success: true, message: 'Sequential generation started' };
    });
}
