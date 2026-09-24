import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import prisma from '../db';
import initiativeService from '../services/initiative.service';
import { normalizeProjectKind } from '../utils/project.utils';
import { sanitizeChannelConfig } from '../utils/channel.utils';
import mcpRoutes from './projects/mcp.routes';
import parserRoutes from './projects/parser.routes';
import projectChannelsRoutes from './projects/channels.routes';
import projectMembersRoutes from './projects/members.routes';
import projectImportExportRoutes from './projects/import_export.routes';
import {
    AuthenticatedUser,
    parseProjectId,
    makeUniqueProjectSlug,
    resolveOwnedOrganizationId
} from './projects/helpers';

export default async function projectRoutes(fastify: FastifyInstance) {
    // Middleware-like check for project routes
    fastify.addHook('preHandler', async (request, reply) => {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) {
            reply.code(401).send({ error: 'Auth required' });
            return;
        }
        try {
            (request as unknown as { user: AuthenticatedUser }).user = authService.verifyToken(token);
        } catch {

            reply.code(401).send({ error: 'Invalid token' });
        }
    });

    // List user projects
    fastify.get('/api/projects', async (request) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const projects = await authService.getUserProjects(user.id);
        return projects;
    });

    // Operational calendar view
    fastify.get('/api/projects/:id/operational-calendar', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id } = request.params as { id: string };
        const { fromDate, toDate } = (request.query as { fromDate?: string; toDate?: string }) || {};
        const projectId = parseProjectId(id);
        const from = fromDate || new Date().toISOString().slice(0, 10);
        const to = toDate || from;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
            return reply.code(400).send({ error: 'fromDate and toDate must be a valid ascending YYYY-MM-DD range' });
        }

        const actorId = `user:${user.id}`;
        try {
            return await initiativeService.getOperationalCalendarView({
                projectId,
                actorId,
                fromDate: from,
                toDate: to
            });
        } catch (error: unknown) {
            const err = error as Error;
            const denied = /Access denied|Security/.test(err?.message || '');
            return reply.code(denied ? 403 : 400).send({ error: err?.message || 'Unable to load operational calendar' });
        }
    });

    // Create project
    fastify.post('/api/projects', async (request) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { name, slug, description, kind, organizationId } = (request.body as {
            name: string;
            slug?: string;
            description?: string;
            kind?: string;
            organizationId?: number | string;
        }) || {};

        const finalSlug = await makeUniqueProjectSlug(slug, name);
        const organization_id = await resolveOwnedOrganizationId(user.id, Number(organizationId) || undefined);
        const project = await prisma.project.create({
            data: {
                name,
                slug: finalSlug,
                description,
                kind: normalizeProjectKind(kind),
                organization_id,
                research_profile: { create: { revision: 1 } },
                members: {
                    create: {
                        user_id: user.id,
                        role: 'owner'
                    }
                }
            }
        });

        return project;
    });

    // Update project settings
    fastify.post('/api/projects/:id/settings', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id } = request.params as { id: string };
        const { key, value } = (request.body as { key: string; value: string }) || {};
        const projectId = parseInt(id, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const setting = await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: key
                }
            },
            update: { value },
            create: {
                project_id: projectId,
                key,
                value
            }
        });

        if (key === 'default_channel_id') {
            const channelId = parseInt(value, 10);
            if (!isNaN(channelId)) {
                await prisma.post.updateMany({
                    where: {
                        project_id: projectId,
                        status: { notIn: ['published', 'publishing'] }
                    },
                    data: {
                        channel_id: channelId
                    }
                });
            }
        }

        return setting;
    });

    // Get project details
    fastify.get('/api/projects/:id', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id } = request.params as { id: string };
        const projectId = parseInt(id, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId);
        if (!hasAccess) {
            reply.code(403).send({ error: 'No access' });
            return;
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                channels: true,
                settings: true,
                _count: { select: { weeks: true } },
                members: {
                    include: { user: { select: { id: true, name: true, email: true } } }
                }
            }
        });

        if (project && project.channels) {
            project.channels = project.channels.map((channel) => ({
                ...channel,
                config: sanitizeChannelConfig(channel.type, channel.config)
            }));
        }

        return project;
    });

    // Update project details
    fastify.put('/api/projects/:id', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id } = request.params as { id: string };
        const { name, slug, description, kind } = (request.body as {
            name?: string;
            slug?: string;
            description?: string | null;
            kind?: string;
        }) || {};
        const projectId = parseInt(id, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can edit project details' });
            return;
        }

        const existing = await prisma.project.findUnique({
            where: { id: projectId }
        });

        if (!existing) {
            reply.code(404).send({ error: 'Project not found' });
            return;
        }

        const finalSlug = typeof slug === 'string' && slug.trim()
            ? await makeUniqueProjectSlug(slug, existing.name, existing.id)
            : undefined;

        const project = await prisma.project.update({
            where: { id: projectId },
            data: {
                ...(typeof name === 'string' ? { name } : {}),
                ...(typeof description === 'string' || description === null ? { description } : {}),
                ...(finalSlug ? { slug: finalSlug } : {}),
                ...(typeof kind === 'string' ? { kind: normalizeProjectKind(kind) } : {})
            }
        });

        return project;
    });

    // Archive project
    fastify.post('/api/projects/:id/archive', async (request, reply) => {
        const user = (request as unknown as { user: AuthenticatedUser }).user;
        const { id } = request.params as { id: string };
        const { archived } = (request.body as { archived?: boolean }) || {};
        const projectId = parseInt(id, 10);

        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            reply.code(403).send({ error: 'Only owners can archive project details' });
            return;
        }

        const nextArchived = archived !== false;
        const project = await prisma.project.update({
            where: { id: projectId },
            data: {
                is_archived: nextArchived,
                archived_at: nextArchived ? new Date() : null
            }
        });

        return project;
    });

    // Sub-routes registration
    await projectImportExportRoutes(fastify);
    await projectChannelsRoutes(fastify);
    await projectMembersRoutes(fastify);
    await mcpRoutes(fastify);
    await parserRoutes(fastify);
}
