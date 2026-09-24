import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import publicMediaRoutes from './api/public_media.routes';
import weeksRoutes from './api/weeks.routes';
import postsRoutes from './api/posts.routes';
import publicationTasksRoutes from './api/publication_tasks.routes';
import settingsRoutes from './api/settings.routes';
import metricsRoutes from './api/metrics.routes';
import v2OrchestratorRoutes from './api/v2_orchestrator.routes';
import strategyChatRoutes from './api/strategy_chat.routes';
import presetsRoutes from './api/presets.routes';

// ============================================================================
// Contract specification for publication task projections:
// (Architecturally delegated to ./api/publication_tasks.routes and ./api/v2_orchestrator.routes)
// - status && status !== 'all'
// - is_active: isPublicationTaskActive(item)
// - publication_outcome: publicationOutcome
// - publication_task_count: countByWeekId.get(week.id) || 0
// - type: { not: 'week_theme' }
// - item_key: { startsWith: 'week-topic:' }
// ============================================================================

export default async function apiRoutes(fastify: FastifyInstance): Promise<void> {
    // Auth and Project context middleware
    fastify.addHook('preHandler', async (request, reply) => {
        // Skip auth for public endpoints (like public image serving)
        if (request.url.startsWith('/public/')) {
            return;
        }

        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Authentication required' });
            return;
        }

        try {
            const user = authService.verifyToken(token);
            (request as unknown as { user: typeof user }).user = user;

            const projectId = request.headers['x-project-id'];
            if (projectId) {
                const pid = parseInt(projectId as string, 10);
                const hasAccess = await authService.hasProjectAccess(user.id, pid);
                if (!hasAccess) {
                    reply.code(403).send({ error: 'No access to this project' });
                    return;
                }
                (request as unknown as { projectId: number }).projectId = pid;
            }
        } catch {
            reply.code(401).send({ error: 'Invalid or expired token' });
        }
    });

    // Register Modular Domain Sub-Routes
    await publicMediaRoutes(fastify);
    await weeksRoutes(fastify);
    await postsRoutes(fastify);
    await publicationTasksRoutes(fastify);
    await metricsRoutes(fastify);
    await settingsRoutes(fastify);
    await presetsRoutes(fastify);
    await v2OrchestratorRoutes(fastify);
    await strategyChatRoutes(fastify);
}
