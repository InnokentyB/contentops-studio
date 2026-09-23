import { FastifyInstance } from 'fastify';
import authService from '../../services/auth.service';
import parserIntegrationService from '../../services/parser_integration.service';

/**
 * Parses and validates raw project ID from URL parameter.
 * @param raw - The string parameter from request.params
 * @returns Parsed integer project ID
 */
function parseProjectId(raw: string): number {
    const value = parseInt(raw, 10);
    if (Number.isNaN(value)) {
        throw new Error('Invalid project id');
    }
    return value;
}

/**
 * Registers project parser integration endpoints (search jobs, insights, templates).
 * @param fastify - The Fastify application instance
 */
export default async function parserRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get('/api/projects/:id/parser/health', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        try {
            const projectId = parseProjectId(id);
            const hasAccess = await authService.hasProjectAccess(user.id, projectId);
            if (!hasAccess) {
                return reply.code(403).send({ error: 'No access' });
            }

            return await parserIntegrationService.getHealth();
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Failed to fetch parser health' });
        }
    });

    fastify.post('/api/projects/:id/parser/search', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        try {
            const projectId = parseProjectId(id);
            const result = await parserIntegrationService.createSearchJob({
                projectId,
                ...(request.body as any)
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to create parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/search/:jobId', async (request, reply) => {
        const user = (request as any).user;
        const { id, jobId } = request.params as { id: string; jobId: string };

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.getSearchJob(projectId, jobId, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to fetch parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.post('/api/projects/:id/parser/search/:jobId/refresh', async (request, reply) => {
        const user = (request as any).user;
        const { id, jobId } = request.params as { id: string; jobId: string };

        try {
            const projectId = parseProjectId(id);
            const body = (request.body || {}) as { idempotencyKey?: string };
            const result = await parserIntegrationService.refreshSearchJob({
                projectId,
                jobId,
                idempotencyKey: body.idempotencyKey
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to refresh parser search job';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/posts', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as { id: string };
        const { limit, offset } = request.query as { limit?: string; offset?: string };

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.listPosts(projectId, { userId: user.id }, {
                limit: limit !== undefined ? parseInt(limit, 10) : undefined,
                offset: offset !== undefined ? parseInt(offset, 10) : undefined
            });
        } catch (error: any) {
            const message = error.message || 'Failed to list parser posts';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/insights', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as { id: string };
        const { limit, offset, jobId, type } = request.query as { limit?: string; offset?: string; jobId?: string; type?: string };

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.getInsights({
                projectId,
                limit: limit !== undefined ? parseInt(limit, 10) : undefined,
                offset: offset !== undefined ? parseInt(offset, 10) : undefined,
                jobId,
                type
            }, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to fetch parser insights';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/summaries/:jobId', async (request, reply) => {
        const user = (request as any).user;
        const { id, jobId } = request.params as { id: string; jobId: string };

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.getSummary({
                projectId,
                jobId
            }, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to fetch parser summary';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.get('/api/projects/:id/parser/templates', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        try {
            const projectId = parseProjectId(id);
            return await parserIntegrationService.listTemplates(projectId, { userId: user.id });
        } catch (error: any) {
            const message = error.message || 'Failed to list parser templates';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.post('/api/projects/:id/parser/templates/import', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        try {
            const projectId = parseProjectId(id);
            const result = await parserIntegrationService.importTemplates({
                projectId,
                ...(request.body as any)
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to import parser templates';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });

    fastify.post('/api/projects/:id/parser/templates/:templateId/run', async (request, reply) => {
        const user = (request as any).user;
        const { id, templateId } = request.params as { id: string; templateId: string };

        try {
            const projectId = parseProjectId(id);
            const body = (request.body || {}) as { idempotencyKey?: string };
            const result = await parserIntegrationService.runTemplate({
                projectId,
                templateId,
                idempotencyKey: body.idempotencyKey
            }, { userId: user.id, minRole: 'editor' });

            return reply.code(202).send(result);
        } catch (error: any) {
            const message = error.message || 'Failed to run parser template';
            const statusCode = message.includes('does not have') ? 403 : 400;
            return reply.code(statusCode).send({ error: message });
        }
    });
}
