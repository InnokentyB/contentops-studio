"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = vkRoutes;
const auth_service_1 = __importDefault(require("../services/auth.service"));
const planner_service_1 = require("../services/planner.service");
const vk_oauth_service_1 = __importDefault(require("../services/vk_oauth.service"));
const channel_utils_1 = require("../utils/channel.utils");
function settingsRedirect(params) {
    const base = (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
    return `${base}/settings?${new URLSearchParams({ tab: 'channels', ...params }).toString()}`;
}
async function vkRoutes(fastify) {
    fastify.post('/api/integrations/vk/connect', async (request, reply) => {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token)
            return reply.code(401).send({ error: 'Auth required' });
        let user;
        try {
            user = auth_service_1.default.verifyToken(token);
        }
        catch {
            return reply.code(401).send({ error: 'Invalid token' });
        }
        const { projectId, channelId } = (request.body || {});
        if (!Number.isInteger(projectId) || !Number.isInteger(channelId)) {
            return reply.code(400).send({ error: 'projectId and channelId are required' });
        }
        if (!await auth_service_1.default.hasProjectAccess(user.id, projectId, 'owner')) {
            return reply.code(403).send({ error: 'Only the project owner can connect VK' });
        }
        const channel = await planner_service_1.prisma.socialChannel.findFirst({ where: { id: channelId, project_id: projectId, type: 'vk' } });
        if (!channel)
            return reply.code(404).send({ error: 'VK channel not found' });
        try {
            const result = vk_oauth_service_1.default.createAuthorization({ projectId: projectId, channelId: channelId, userId: user.id });
            return { authorization_url: result.authorizationUrl };
        }
        catch (error) {
            return reply.code(503).send({ error: error.message || 'VK OAuth is not configured' });
        }
    });
    fastify.get('/api/integrations/vk/callback', async (request, reply) => {
        const query = request.query;
        if (query.error)
            return reply.redirect(settingsRedirect({ vk: 'error', reason: 'authorization_denied' }));
        if (!query.code || !query.state || !query.device_id) {
            return reply.redirect(settingsRedirect({ vk: 'error', reason: 'incomplete_callback' }));
        }
        try {
            const state = vk_oauth_service_1.default.readState(query.state);
            if (!await auth_service_1.default.hasProjectAccess(state.userId, state.projectId, 'owner')) {
                throw new Error('VK connection owner access is no longer valid');
            }
            const channel = await planner_service_1.prisma.socialChannel.findFirst({
                where: { id: state.channelId, project_id: state.projectId, type: 'vk' }
            });
            if (!channel)
                throw new Error('VK channel no longer exists');
            const currentConfig = (0, channel_utils_1.resolveEffectiveChannelConfig)(channel.type, channel.config);
            if (!currentConfig.vk_id)
                throw new Error('VK community ID is missing from channel settings');
            const token = await vk_oauth_service_1.default.exchangeCode({
                code: query.code,
                deviceId: query.device_id,
                state: query.state,
                verifier: state.verifier
            });
            const identity = await vk_oauth_service_1.default.verifyCommunityAdmin(token.access_token, String(currentConfig.vk_id));
            const nextConfig = (0, channel_utils_1.prepareChannelConfigForStorage)('vk', {
                ...channel.config,
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
            await planner_service_1.prisma.socialChannel.update({ where: { id: channel.id }, data: { config: nextConfig } });
            return reply.redirect(settingsRedirect({ vk: 'connected', channelId: String(channel.id) }));
        }
        catch (error) {
            request.log.warn({ err: error?.message }, 'VK OAuth callback failed');
            return reply.redirect(settingsRedirect({ vk: 'error', reason: 'connection_failed' }));
        }
    });
}
