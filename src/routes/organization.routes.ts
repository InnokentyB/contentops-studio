import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import authService from '../services/auth.service';
import prisma from '../db';
import organizationIntelligenceService from '../services/organization_intelligence.service';

function fail(reply: FastifyReply, error: unknown) {
    const message = error instanceof Error ? error.message : 'Organization intelligence request failed';
    const status = message.includes('[Security]') ? 403
        : message.includes('NOT_FOUND') ? 404
            : message.includes('IDEMPOTENCY_CONFLICT') ? 409 : 400;
    return reply.code(status).send({ error: message });
}

export default async function organizationRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', async (request, reply) => {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) return reply.code(401).send({ error: 'Authentication required' });
        try { (request as any).user = authService.verifyToken(token); }
        catch { return reply.code(401).send({ error: 'Invalid token' }); }
    });

    fastify.get('/api/organizations', async (request) => {
        const user = (request as any).user;
        const memberships = await prisma.organizationMember.findMany({
            where: { user_id: user.id, organization: { is_archived: false } },
            include: { organization: true }, orderBy: { organization_id: 'asc' },
        });
        return { organizations: memberships.map((membership) => ({ ...membership.organization, role: membership.role })) };
    });

    fastify.get('/api/organizations/:organizationId/intelligence/context', async (request, reply) => {
        try {
            const { organizationId } = request.params as { organizationId: string };
            return await organizationIntelligenceService.getContext({ organizationId: Number(organizationId), userId: (request as any).user.id });
        } catch (error) { return fail(reply, error); }
    });

    fastify.post('/api/organizations/:organizationId/intelligence/search', async (request, reply) => {
        try {
            const { organizationId } = request.params as { organizationId: string };
            const body = request.body as { query?: string; sources?: string[]; projectIds?: number[]; idempotencyKey?: string };
            const user = (request as any).user;
            return await organizationIntelligenceService.search({
                organizationId: Number(organizationId), userId: user.id, actorId: `user:${user.id}`,
                query: String(body.query || ''), sources: Array.isArray(body.sources) ? body.sources : [],
                projectScope: body.projectIds?.length ? { mode: 'selected', projectIds: body.projectIds.map(Number) } : { mode: 'all_active' },
                idempotencyKey: body.idempotencyKey || randomUUID(),
            });
        } catch (error) { return fail(reply, error); }
    });

    fastify.get('/api/organizations/:organizationId/intelligence/runs/:runId', async (request, reply) => {
        try {
            const { organizationId, runId } = request.params as { organizationId: string; runId: string };
            return await organizationIntelligenceService.getResearchRun({ organizationId: Number(organizationId), researchRunId: Number(runId), userId: (request as any).user.id });
        } catch (error) { return fail(reply, error); }
    });

    fastify.get('/api/organizations/:organizationId/intelligence/runs', async (request, reply) => {
        try {
            const { organizationId } = request.params as { organizationId: string };
            await organizationIntelligenceService.getContext({ organizationId: Number(organizationId), userId: (request as any).user.id });
            const runs = await prisma.researchRun.findMany({
                where: { organization_id: Number(organizationId) },
                orderBy: { created_at: 'desc' }, take: 30,
                select: {
                    id: true, query: true, requested_sources: true, status: true,
                    source_outcomes: true, created_at: true, completed_at: true,
                    _count: { select: { signals: true } },
                },
            });
            return { runs: runs.map((run) => ({ ...run, state: run.status, signal_count: run._count.signals, _count: undefined })) };
        } catch (error) { return fail(reply, error); }
    });

    fastify.patch('/api/organizations/:organizationId/intelligence/sources/:connectionId', async (request, reply) => {
        try {
            const { organizationId, connectionId } = request.params as { organizationId: string; connectionId: string };
            const user = (request as any).user;
            const membership = await prisma.organizationMember.findUnique({
                where: { organization_id_user_id: { organization_id: Number(organizationId), user_id: user.id } },
            });
            if (membership?.role !== 'owner') return reply.code(403).send({ error: 'Organization owner access required' });
            const body = request.body as { isActive?: boolean };
            if (typeof body.isActive !== 'boolean') return reply.code(400).send({ error: 'isActive must be boolean' });
            const connection = await prisma.researchConnection.findFirst({
                where: { id: Number(connectionId), organization_id: Number(organizationId) },
            });
            if (!connection) return reply.code(404).send({ error: 'Research connection not found' });
            return { connection: await prisma.researchConnection.update({ where: { id: connection.id }, data: { is_active: body.isActive } }) };
        } catch (error) { return fail(reply, error); }
    });

    fastify.get('/api/organizations/:organizationId/intelligence/signals', async (request, reply) => {
        try {
            const { organizationId } = request.params as { organizationId: string };
            await organizationIntelligenceService.getContext({ organizationId: Number(organizationId), userId: (request as any).user.id });
            const signals = await prisma.sourceSignal.findMany({
                where: { organization_id: Number(organizationId) }, include: {
                    assessments: { include: { project: { select: { id: true, name: true } } } },
                    routes: true
                },
                orderBy: { last_observed_at: 'desc' }, take: 100,
            });
            return { signals };
        } catch (error) { return fail(reply, error); }
    });

    fastify.put('/api/organizations/:organizationId/intelligence/projects/:projectId/profile', async (request, reply) => {
        try {
            const { organizationId, projectId } = request.params as { organizationId: string; projectId: string };
            const user = (request as any).user;
            const project = await prisma.project.findFirst({ where: { id: Number(projectId), organization_id: Number(organizationId), is_archived: false } });
            if (!project || !await authService.hasProjectAccess(user.id, project.id, 'editor')) return reply.code(403).send({ error: 'Project owner or editor access required' });
            const body = request.body as Record<string, unknown>;
            const list = (key: string) => Array.isArray(body[key]) ? (body[key] as unknown[]).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 100) : [];
            const data = {
                audience: list('audience'), problems: list('problems'), themes: list('themes'), products: list('products'),
                competitors: list('competitors'), include_terms: list('include_terms'), exclude_terms: list('exclude_terms'),
                languages: list('languages'), geographies: list('geographies'), updated_by: user.id,
            };
            const profile = await prisma.projectResearchProfile.upsert({
                where: { project_id: project.id }, create: { project_id: project.id, revision: 1, ...data },
                update: { ...data, revision: { increment: 1 } }
            });
            await organizationIntelligenceService.reassessProject({ organizationId: Number(organizationId), projectId: project.id, userId: user.id, actorId: `user:${user.id}` });
            return { profile };
        } catch (error) { return fail(reply, error); }
    });

    fastify.post('/api/organizations/:organizationId/intelligence/signals/:signalId/route', async (request, reply) => {
        try {
            const { organizationId, signalId } = request.params as { organizationId: string; signalId: string };
            const body = request.body as { projectId: number; assessmentRevision?: number; decision?: 'routed' | 'dismissed'; note?: string; idempotencyKey?: string };
            const user = (request as any).user;
            return await organizationIntelligenceService.routeSignal({ organizationId: Number(organizationId), signalId: Number(signalId), projectId: Number(body.projectId), assessmentRevision: Number(body.assessmentRevision || 1), decision: body.decision || 'routed', note: body.note, idempotencyKey: body.idempotencyKey || randomUUID(), userId: user.id, actorId: `user:${user.id}` });
        } catch (error) { return fail(reply, error); }
    });

    fastify.post('/api/organizations/:organizationId/intelligence/signals/:signalId/promote', async (request, reply) => {
        try {
            const { signalId } = request.params as { organizationId: string; signalId: string };
            const body = request.body as { projectId: number; routeId?: number; target?: 'initiative' | 'research_task' | 'publication_theme'; title?: string; brief?: string; idempotencyKey?: string };
            const user = (request as any).user;
            let routeId = body.routeId;
            if (!routeId) {
                routeId = (await prisma.projectSignalRoute.findFirst({ where: { signal_id: Number(signalId), project_id: Number(body.projectId), state: 'routed' }, orderBy: { created_at: 'desc' } }))?.id;
            }
            if (!routeId) throw new Error('[SIGNAL_NOT_ROUTED] Signal must be routed before promotion');
            return await organizationIntelligenceService.promoteSignal({ projectId: Number(body.projectId), routeId, target: body.target || 'initiative', title: body.title, brief: body.brief, idempotencyKey: body.idempotencyKey || randomUUID(), userId: user.id, actorId: `user:${user.id}` });
        } catch (error) { return fail(reply, error); }
    });
}
