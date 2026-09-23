import { FastifyInstance } from 'fastify';
import prisma from '../../db';
import authService from '../../services/auth.service';
import mcpAccessTokenService, { ActiveMcpWorkspaceBundleError, isManagedMcpProfile } from '../../services/mcp_access_token.service';

export default async function mcpRoutes(fastify: FastifyInstance) {
    fastify.get('/api/projects/:id/mcp/status', async (request, reply) => {
        const user = (request as any).user;
        const { id } = request.params as { id: string };
        const projectId = parseInt(id, 10);
        const hasAccess = await authService.hasProjectAccess(user.id, projectId, 'owner');
        if (!hasAccess) {
            return reply.code(403).send({ error: 'Only owners can inspect MCP settings' });
        }

        const endpoint = (process.env.MCP_REMOTE_URL || 'http://127.0.0.1:8080/mcp').replace(/\/+$/, '');
        const healthUrl = endpoint.endsWith('/mcp') ? endpoint.slice(0, -4) + '/health' : `${endpoint}/health`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        try {
            const response = await fetch(healthUrl, { signal: controller.signal });
            const health = response.ok ? await response.json() as any : null;
            const capabilityEndpoints = health?.capability_endpoints || {};
            const capabilityStatus = (profile: Exclude<import('../../mcp/capabilities').McpCapabilityProfile, 'owner'>) => {
                const remote = capabilityEndpoints[profile];
                const configured = remote === true || remote?.configured === true;
                const boundProjectId = Number(remote?.project_id || 0) || null;
                const boundOrganizationId = Number(remote?.organization_id || 0) || null;
                return {
                    endpoint: `${endpoint}/${profile.replace(/_/g, '-')}`,
                    configured: configured && (profile === 'organization_researcher' || !boundProjectId || boundProjectId === projectId),
                    bound_project_id: boundProjectId,
                    bound_organization_id: boundOrganizationId
                };
            };
            return {
                status: response.ok && health?.status === 'ok' ? 'online' : 'degraded',
                endpoint,
                health_url: healthUrl,
                transport: health?.transport || null,
                bearer_required: Boolean(health?.auth?.bearer_required),
                uptime_s: health?.uptime_s || 0,
                active_sessions: health?.active_sessions || 0,
                capability_endpoints: {
                    planner: capabilityStatus('planner'),
                    writer: capabilityStatus('writer'),
                    art_director: capabilityStatus('art_director'),
                    strategist: capabilityStatus('strategist'),
                    editor: capabilityStatus('editor'),
                    publisher: capabilityStatus('publisher'),
                    growth_analyst: capabilityStatus('growth_analyst'),
                    organization_researcher: capabilityStatus('organization_researcher')
                },
                checked_at: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                status: 'offline',
                endpoint,
                health_url: healthUrl,
                bearer_required: null,
                checked_at: new Date().toISOString(),
                message: error?.name === 'AbortError' ? 'MCP health check timed out' : 'MCP server is unreachable'
            };
        } finally {
            clearTimeout(timeout);
        }
    });

    fastify.get('/api/projects/:id/mcp/access-tokens', async (request, reply) => {
        const user = (request as any).user;
        const projectId = parseInt((request.params as { id: string }).id, 10);
        if (!await authService.hasProjectAccess(user.id, projectId, 'owner')) return reply.code(403).send({ error: 'Owner access required' });
        const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organization_id: true } });
        const organizationMembership = project?.organization_id ? await prisma.organizationMember.findUnique({ where: { organization_id_user_id: { organization_id: project.organization_id, user_id: user.id } } }) : null;
        const accesses = [
            ...await mcpAccessTokenService.list(projectId),
            ...(project?.organization_id && organizationMembership?.role === 'owner' ? await mcpAccessTokenService.listForOrganization(project.organization_id) : [])
        ];
        return {
            accesses: accesses.map(({ token_hash: _tokenHash, ...access }) => access)
        };
    });

    fastify.post('/api/projects/:id/mcp/access-tokens', async (request, reply) => {
        const owner = (request as any).user;
        const projectId = parseInt((request.params as { id: string }).id, 10);
        if (!await authService.hasProjectAccess(owner.id, projectId, 'owner')) return reply.code(403).send({ error: 'Owner access required' });
        const { userId, profile, label, expiresAt } = request.body as { userId: number; profile: unknown; label?: string; expiresAt?: string | null };
        if (!Number.isInteger(userId) || !isManagedMcpProfile(profile)) return reply.code(400).send({ error: 'Valid user and MCP profile are required' });
        const expiry = expiresAt ? new Date(expiresAt) : null;
        if (expiry && (Number.isNaN(expiry.getTime()) || expiry <= new Date())) return reply.code(400).send({ error: 'Expiry must be in the future' });
        try {
            reply.header('Cache-Control', 'no-store');
            if (profile === 'organization_researcher') {
                const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organization_id: true } });
                if (!project?.organization_id) return reply.code(409).send({ error: 'Project is not attached to an organization' });
                const organizationOwner = await prisma.organizationMember.findUnique({ where: { organization_id_user_id: { organization_id: project.organization_id, user_id: owner.id } } });
                if (organizationOwner?.role !== 'owner') return reply.code(403).send({ error: 'Organization owner access required' });
                return await mcpAccessTokenService.createForOrganization(project.organization_id, userId, profile, label || '', expiry);
            }
            return await mcpAccessTokenService.create(projectId, userId, profile, label || '', expiry);
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Unable to create MCP access' });
        }
    });

    fastify.post('/api/projects/:id/mcp/workspace-access', async (request, reply) => {
        const owner = (request as any).user;
        const projectId = parseInt((request.params as { id: string }).id, 10);
        if (!await authService.hasProjectAccess(owner.id, projectId, 'owner')) return reply.code(403).send({ error: 'Owner access required' });
        const { userId, label, expiresAt, rotate } = request.body as { userId: number; label?: string; expiresAt?: string | null; rotate?: boolean };
        if (!Number.isInteger(userId)) return reply.code(400).send({ error: 'Valid project member is required' });
        const expiry = expiresAt ? new Date(expiresAt) : null;
        if (expiry && (Number.isNaN(expiry.getTime()) || expiry <= new Date())) return reply.code(400).send({ error: 'Expiry must be in the future' });
        const endpoint = (process.env.MCP_REMOTE_URL || 'http://127.0.0.1:8080/mcp').replace(/\/+$/, '');
        try {
            reply.header('Cache-Control', 'no-store');
            return await mcpAccessTokenService.createWorkspaceBundle(projectId, userId, label || '', endpoint, { expiresAt: expiry, rotate: rotate === true });
        } catch (error: any) {
            if (error instanceof ActiveMcpWorkspaceBundleError) {
                return reply.code(409).send({ error: error.message, code: 'MCP_WORKSPACE_ACTIVE', bundle_id: error.bundleId });
            }
            return reply.code(400).send({ error: error.message || 'Unable to create agent workspace access' });
        }
    });

    fastify.delete('/api/projects/:id/mcp/workspace-access/:bundleId', async (request, reply) => {
        const owner = (request as any).user;
        const { id, bundleId } = request.params as { id: string; bundleId: string };
        const projectId = parseInt(id, 10);
        if (!await authService.hasProjectAccess(owner.id, projectId, 'owner')) return reply.code(403).send({ error: 'Owner access required' });
        if (!/^[0-9a-f-]{36}$/i.test(bundleId)) return reply.code(400).send({ error: 'Valid workspace bundle ID is required' });
        try {
            return await mcpAccessTokenService.revokeWorkspaceBundle(projectId, bundleId);
        } catch (error: any) {
            return reply.code(404).send({ error: error.message || 'MCP workspace bundle was not found' });
        }
    });

    fastify.delete('/api/projects/:id/mcp/access-tokens/:tokenId', async (request, reply) => {
        const owner = (request as any).user;
        const { id, tokenId } = request.params as { id: string; tokenId: string };
        const projectId = parseInt(id, 10);
        if (!await authService.hasProjectAccess(owner.id, projectId, 'owner')) return reply.code(403).send({ error: 'Owner access required' });
        try {
            const access = await prisma.mcpAccessToken.findUnique({ where: { id: parseInt(tokenId, 10) }, select: { organization_id: true } });
            if (access?.organization_id) {
                const membership = await prisma.organizationMember.findUnique({ where: { organization_id_user_id: { organization_id: access.organization_id, user_id: owner.id } } });
                if (membership?.role !== 'owner') return reply.code(403).send({ error: 'Organization owner access required' });
                await mcpAccessTokenService.revokeForOrganization(access.organization_id, parseInt(tokenId, 10));
                return { success: true };
            }
            await mcpAccessTokenService.revoke(projectId, parseInt(tokenId, 10));
            return { success: true };
        } catch (error: any) {
            return reply.code(400).send({ error: error.message || 'Unable to revoke MCP access' });
        }
    });
}
