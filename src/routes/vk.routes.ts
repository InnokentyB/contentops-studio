import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import { prisma } from '../services/planner.service';
import vkOAuthService from '../services/vk_oauth.service';
import { prepareChannelConfigForStorage, resolveEffectiveChannelConfig } from '../utils/channel.utils';

function settingsRedirect(params: Record<string, string>) {
    const base = (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
    return `${base}/settings?${new URLSearchParams({ tab: 'channels', ...params }).toString()}`;
}

export default async function vkRoutes(fastify: FastifyInstance) {
    fastify.post('/api/integrations/vk/connect', async (request, reply) => {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) return reply.code(401).send({ error: 'Auth required' });
        let user;
        try {
            user = authService.verifyToken(token);
        } catch {
            return reply.code(401).send({ error: 'Invalid token' });
        }
        const { projectId, channelId } = (request.body || {}) as { projectId?: number; channelId?: number };
        if (!Number.isInteger(projectId) || !Number.isInteger(channelId)) {
            return reply.code(400).send({ error: 'projectId and channelId are required' });
        }
        if (!await authService.hasProjectAccess(user.id, projectId!, 'owner')) {
            return reply.code(403).send({ error: 'Only the project owner can connect VK' });
        }
        const channel = await prisma.socialChannel.findFirst({ where: { id: channelId, project_id: projectId, type: 'vk' } });
        if (!channel) return reply.code(404).send({ error: 'VK channel not found' });
        try {
            const result = vkOAuthService.createAuthorization({ projectId: projectId!, channelId: channelId!, userId: user.id });
            return { authorization_url: result.authorizationUrl };
        } catch (error: any) {
            return reply.code(503).send({ error: error.message || 'VK OAuth is not configured' });
        }
    });

    fastify.get('/api/integrations/vk/callback', async (request, reply) => {
        const query = request.query as Record<string, string | undefined>;
        if (query.error) return reply.redirect(settingsRedirect({ vk: 'error', reason: 'authorization_denied' }));
        if (!query.code || !query.state || !query.device_id) {
            return reply.redirect(settingsRedirect({ vk: 'error', reason: 'incomplete_callback' }));
        }
        try {
            const state = vkOAuthService.readState(query.state);
            if (!await authService.hasProjectAccess(state.userId, state.projectId, 'owner')) {
                throw new Error('VK connection owner access is no longer valid');
            }
            const channel = await prisma.socialChannel.findFirst({
                where: { id: state.channelId, project_id: state.projectId, type: 'vk' }
            });
            if (!channel) throw new Error('VK channel no longer exists');
            const currentConfig = resolveEffectiveChannelConfig(channel.type, channel.config);
            if (!currentConfig.vk_id) throw new Error('VK community ID is missing from channel settings');
            const token = await vkOAuthService.exchangeCode({
                code: query.code,
                deviceId: query.device_id,
                state: query.state,
                verifier: state.verifier
            });
            const identity = await vkOAuthService.verifyCommunityAdmin(
                token.access_token,
                String(currentConfig.vk_id),
                token.user_id
            );
            const nextConfig = prepareChannelConfigForStorage('vk', {
                ...(channel.config as any),
                publish_access_token: token.access_token,
                stats_access_token: token.access_token,
                ...(token.refresh_token ? { vk_refresh_token: token.refresh_token } : {}),
                analytics_enabled: true,
                api_version: '5.199',
                oauth_provider: 'vk_id',
                oauth_user_id: identity.userId,
                oauth_connected_at: new Date().toISOString(),
                oauth_expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null
            });
            await prisma.socialChannel.update({ where: { id: channel.id }, data: { config: nextConfig } });
            return reply.redirect(settingsRedirect({ vk: 'connected', channelId: String(channel.id) }));
        } catch (error: any) {
            request.log.warn({ err: error?.message }, 'VK OAuth callback failed');
            return reply.redirect(settingsRedirect({ vk: 'error', reason: 'connection_failed' }));
        }
    });
}
