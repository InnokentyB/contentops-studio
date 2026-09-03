import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// Import our utility functions
import {
    sanitizeChannelConfig,
    mergeChannelConfig,
    cleanAndFormatHashtags,
    prepareChannelConfigForStorage,
    resolveChannelConfigSecrets,
    resolveEffectiveChannelConfig
} from '../utils/channel.utils';
import projectRoutes from '../routes/project.routes';
import authService from '../services/auth.service';
import { prisma } from '../services/planner.service';
import plannerService from '../services/planner.service';
import mcpAccessTokenService, { ActiveMcpWorkspaceBundleError } from '../services/mcp_access_token.service';

test('sanitizeChannelConfig masks sensitive fields', () => {
    const config = {
        telegram_channel_id: '-100123456',
        channel_username: '@mychannel',
        api_key: 'super-secret-vk-key',
        publish_access_token: 'vk-publish-token',
        stats_access_token: 'vk-stats-token',
        access_token: 'threads-token',
        cookies: 'session=abc',
        application_secret_key: 'ok-app-secret'
    };

    const sanitized = sanitizeChannelConfig('telegram', config);

    assert.equal(sanitized.telegram_channel_id, '-100123456');
    assert.equal(sanitized.channel_username, '@mychannel');
    assert.equal(sanitized.api_key, '******');
    assert.equal(sanitized.publish_access_token, '******');
    assert.equal(sanitized.stats_access_token, '******');
    assert.equal(sanitized.access_token, '******');
    assert.equal(sanitized.cookies, '******');
    assert.equal(sanitized.application_secret_key, '******');
});

test('mergeChannelConfig preserves existing secrets when incoming is masked', () => {
    const existingConfig = {
        api_key: 'original-vk-key',
        publish_access_token: 'original-vk-publish-token',
        stats_access_token: 'original-vk-stats-token',
        access_token: 'original-threads-token',
        cookies: 'original-session',
        application_secret_key: 'original-ok-secret'
    };

    const incomingConfig = {
        telegram_channel_id: '-100999888',
        api_key: '******',
        publish_access_token: '******',
        stats_access_token: '******',
        access_token: '******',
        cookies: '******',
        application_secret_key: '******'
    };

    const merged = mergeChannelConfig(incomingConfig, existingConfig);

    assert.equal(merged.telegram_channel_id, '-100999888');
    assert.equal(merged.api_key, 'original-vk-key');
    assert.equal(merged.publish_access_token, 'original-vk-publish-token');
    assert.equal(merged.stats_access_token, 'original-vk-stats-token');
    assert.equal(merged.access_token, 'original-threads-token');
    assert.equal(merged.cookies, 'original-session');
    assert.equal(merged.application_secret_key, 'original-ok-secret');
});

test('mergeChannelConfig updates secrets when incoming has actual new values', () => {
    const existingConfig = {
        api_key: 'original-vk-key',
        access_token: 'original-threads-token'
    };

    const incomingConfig = {
        api_key: 'new-vk-key',
        access_token: '******'
    };

    const merged = mergeChannelConfig(incomingConfig, existingConfig);

    assert.equal(merged.api_key, 'new-vk-key');
    assert.equal(merged.access_token, 'original-threads-token');
});

test('Dzen session cookies are encrypted at rest and masked in API responses', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-only-channel-secret-key-at-least-32-chars';
    try {
        const stored = prepareChannelConfigForStorage('zen', {
            channel_id: 'channel-1',
            cookies: 'Session_id=secret-session; yandexuid=123'
        });

        assert.equal(stored.cookies, undefined);
        assert.match(stored.cookies_encrypted, /^enc:v1:/);
        assert.equal(JSON.stringify(stored).includes('secret-session'), false);

        const sanitized = sanitizeChannelConfig('zen', stored);
        assert.equal(sanitized.cookies, '******');
        assert.equal(sanitized.cookies_encrypted, undefined);

        const resolved = resolveChannelConfigSecrets('zen', stored);
        assert.equal(resolved.cookies, 'Session_id=secret-session; yandexuid=123');
        assert.equal(resolved.cookies_encrypted, undefined);
    } finally {
        if (previousKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});

test('Dzen credentials nested in raw_account are also encrypted and redacted', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-only-channel-secret-key-at-least-32-chars';
    try {
        const stored = prepareChannelConfigForStorage('dzen', {
            platform: 'dzen',
            raw_account: { channel_id: 'nested', cookies: 'Session_id=nested-secret' }
        });
        assert.equal(stored.raw_account.cookies, undefined);
        assert.match(stored.raw_account.cookies_encrypted, /^enc:v1:/);
        const sanitized = sanitizeChannelConfig('dzen', stored);
        assert.equal(sanitized.raw_account.cookies, '******');
        assert.equal(sanitized.raw_account.cookies_encrypted, undefined);
    } finally {
        if (previousKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});

test('Dzen credentials nested in raw_account are resolved for connection checks', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-channel-secret-key-at-least-32-chars';
    try {
        const stored = prepareChannelConfigForStorage('dzen', {
            raw_account: { cookies: 'zen_session_id=nested-session' }
        });
        const resolved = resolveChannelConfigSecrets('dzen', stored);

        assert.equal(resolved.cookies, 'zen_session_id=nested-session');
        assert.equal(resolved.raw_account.cookies, 'zen_session_id=nested-session');
    } finally {
        if (previousKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});

test('effective Dzen config keeps legacy raw_account fields but prefers rotated top-level session', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-channel-secret-key-at-least-32-chars';
    try {
        const stored = prepareChannelConfigForStorage('dzen', {
            channel_id: 'current-channel',
            cookies: 'Session_id=current-session; sessionid2=current-session-2',
            workflow_mode: 'auto_publish',
            raw_account: {
                platform: 'dzen',
                channel_id: 'legacy-channel'
            }
        });

        const resolved = resolveEffectiveChannelConfig('dzen', stored);

        assert.equal(resolved.platform, 'dzen');
        assert.equal(resolved.channel_id, 'current-channel');
        assert.equal(resolved.cookies, 'Session_id=current-session; sessionid2=current-session-2');
        assert.equal(resolved.workflow_mode, 'auto_publish');
        assert.equal(resolved.raw_account, undefined);
    } finally {
        if (previousKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});

test('GET /api/projects/:id masks secrets', async () => {
    // 1. Mock auth checks
    const originalVerifyToken = authService.verifyToken;
    const originalHasAccess = authService.hasProjectAccess;
    authService.verifyToken = () => ({ id: 1, email: 'test@example.com', name: 'Test' });
    authService.hasProjectAccess = async () => true;

    // 2. Mock prisma.project.findUnique
    const originalFindUnique = prisma.project.findUnique;
    Object.defineProperty(prisma.project, 'findUnique', {
        value: async () => ({
            id: 1,
            name: 'Test Project',
            channels: [
                {
                    id: 10,
                    type: 'vk',
                    name: 'VK Community',
                    config: {
                        vk_id: '-999',
                        api_key: 'super-secret-key-123'
                    }
                }
            ]
        }),
        configurable: true,
        writable: true
    });

    // 3. Initialize Fastify app
    const app = Fastify();
    app.register(projectRoutes);

    try {
        const response = await app.inject({
            method: 'GET',
            url: '/api/projects/1',
            headers: {
                authorization: 'Bearer mock-token'
            }
        });

        assert.equal(response.statusCode, 200);
        const data = JSON.parse(response.body);
        assert.equal(data.channels[0].config.api_key, '******');
        assert.equal(data.channels[0].config.vk_id, '-999');
    } finally {
        authService.verifyToken = originalVerifyToken;
        authService.hasProjectAccess = originalHasAccess;
        Object.defineProperty(prisma.project, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
    }
});

test('PUT /api/projects/:id/channels/:channelId merges configs', async () => {
    // 1. Mock auth checks
    const originalVerifyToken = authService.verifyToken;
    const originalHasAccess = authService.hasProjectAccess;
    authService.verifyToken = () => ({ id: 1, email: 'test@example.com', name: 'Test' });
    authService.hasProjectAccess = async () => true;

    // 2. Mock prisma.socialChannel.findUnique and prisma.socialChannel.update
    const originalFindUniqueChannel = prisma.socialChannel.findUnique;
    const originalUpdateChannel = prisma.socialChannel.update;

    Object.defineProperty(prisma.socialChannel, 'findUnique', {
        value: async () => ({
            id: 10,
            type: 'vk',
            name: 'VK Community',
            config: {
                vk_id: '-999',
                api_key: 'super-secret-key-123'
            }
        }),
        configurable: true,
        writable: true
    });

    let updatedConfig: any = null;
    Object.defineProperty(prisma.socialChannel, 'update', {
        value: async (args: any) => {
            updatedConfig = args.data.config;
            return {
                id: 10,
                type: 'vk',
                name: 'VK Community',
                config: updatedConfig
            };
        },
        configurable: true,
        writable: true
    });

    // 3. Initialize Fastify app
    const app = Fastify();
    app.register(projectRoutes);

    try {
        const response = await app.inject({
            method: 'PUT',
            url: '/api/projects/1/channels/10',
            headers: {
                authorization: 'Bearer mock-token'
            },
            payload: {
                name: 'VK Community Updated',
                config: {
                    vk_id: '-999',
                    api_key: '******'
                }
            }
        });

        assert.equal(response.statusCode, 200);
        // Verify merge was called and original secret VK api_key is preserved in database call
        assert.equal(updatedConfig.api_key, 'super-secret-key-123');
        
        // Verify response returned to user is sanitized (masked)
        const data = JSON.parse(response.body);
        assert.equal(data.config.api_key, '******');
    } finally {
        authService.verifyToken = originalVerifyToken;
        authService.hasProjectAccess = originalHasAccess;
        Object.defineProperty(prisma.socialChannel, 'findUnique', {
            value: originalFindUniqueChannel,
            configurable: true,
            writable: true
        });
        Object.defineProperty(prisma.socialChannel, 'update', {
            value: originalUpdateChannel,
            configurable: true,
            writable: true
        });
    }
});

test('PUT /api/projects/:id/channels/:channelId requires project owner', async () => {
    const originalVerifyToken = authService.verifyToken;
    const originalHasAccess = authService.hasProjectAccess;
    let requestedRole: string | undefined;
    authService.verifyToken = () => ({ id: 2, email: 'editor@example.com', name: 'Editor' });
    authService.hasProjectAccess = async (_userId, _projectId, role) => {
        requestedRole = role;
        return false;
    };

    const app = Fastify();
    app.register(projectRoutes);

    try {
        const response = await app.inject({
            method: 'PUT',
            url: '/api/projects/1/channels/10',
            headers: { authorization: 'Bearer mock-token' },
            payload: { name: 'Blocked update', config: { workflow_mode: 'auto_publish' } }
        });

        assert.equal(requestedRole, 'owner');
        assert.equal(response.statusCode, 403);
    } finally {
        authService.verifyToken = originalVerifyToken;
        authService.hasProjectAccess = originalHasAccess;
    }
});

test('mergeChannelConfig keeps channel workflow mode', () => {
    const merged = mergeChannelConfig(
        { workflow_mode: 'approval_required' },
        { workflow_mode: 'prepare_only', api_key: 'secret' }
    );

    assert.equal(merged.workflow_mode, 'approval_required');
});

test('GET /api/projects/:id/mcp/status reports the configured MCP health', async () => {
    const originalVerifyToken = authService.verifyToken;
    const originalHasAccess = authService.hasProjectAccess;
    const originalFetch = global.fetch;
    authService.verifyToken = () => ({ id: 1, email: 'owner@example.com', name: 'Owner' });
    authService.hasProjectAccess = async (_userId, _projectId, role) => role === 'owner';
    global.fetch = async () => new Response(JSON.stringify({
        status: 'ok', transport: 'streamable-http', auth: { bearer_required: false }, uptime_s: 12, active_sessions: 1,
        capability_endpoints: {
            planner: { configured: true, project_id: 1, user_id: 1 },
            writer: { configured: true, project_id: 1, user_id: 1 },
            editor: { configured: true }, publisher: { configured: true }, growth_analyst: { configured: true }
        }
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const app = Fastify();
    app.register(projectRoutes);
    try {
        const response = await app.inject({ method: 'GET', url: '/api/projects/1/mcp/status', headers: { authorization: 'Bearer mock-token' } });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.status, 'online');
        assert.equal(body.bearer_required, false);
        assert.equal(body.transport, 'streamable-http');
        assert.equal(body.capability_endpoints.planner.configured, true);
        assert.match(body.capability_endpoints.planner.endpoint, /\/mcp\/planner$/);
        assert.equal(body.capability_endpoints.writer.configured, true);
        assert.equal(body.capability_endpoints.editor.configured, true);
        assert.match(body.capability_endpoints.growth_analyst.endpoint, /\/mcp\/growth-analyst$/);
    } finally {
        authService.verifyToken = originalVerifyToken;
        authService.hasProjectAccess = originalHasAccess;
        global.fetch = originalFetch;
    }
});

test('POST /api/projects/:id/mcp/workspace-access issues the seven-role bundle only for an owner', async () => {
    const originalVerifyToken = authService.verifyToken;
    const originalHasAccess = authService.hasProjectAccess;
    const originalCreateWorkspaceBundle = mcpAccessTokenService.createWorkspaceBundle;
    authService.verifyToken = () => ({ id: 1, email: 'owner@example.com', name: 'Owner' });
    authService.hasProjectAccess = async (_userId, _projectId, role) => role === 'owner';
    let received: unknown[] = [];
    mcpAccessTokenService.createWorkspaceBundle = async (...args: any[]) => {
        received = args;
        return { bundle_id: 'bundle-1', accesses: new Array(7).fill(null), config: { mcpServers: {} }, bootstrap_prompt: 'bootstrap' } as any;
    };

    const app = Fastify();
    app.register(projectRoutes);
    try {
        const response = await app.inject({
            method: 'POST',
            url: '/api/projects/10/mcp/workspace-access',
            headers: { authorization: 'Bearer mock-token' },
            payload: { userId: 22, label: 'Codex Cloud', expiresAt: '2026-12-01T00:00:00.000Z', rotate: true }
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(received.slice(0, 4), [10, 22, 'Codex Cloud', 'http://127.0.0.1:8080/mcp']);
        assert.equal((received[4] as any).rotate, true);
        assert.equal((received[4] as any).expiresAt.toISOString(), '2026-12-01T00:00:00.000Z');
        assert.equal(JSON.parse(response.body).accesses.length, 7);
    } finally {
        authService.verifyToken = originalVerifyToken;
        authService.hasProjectAccess = originalHasAccess;
        mcpAccessTokenService.createWorkspaceBundle = originalCreateWorkspaceBundle;
    }
});

test('workspace access API reports an active bundle and revokes a complete bundle', async () => {
    const originalVerifyToken = authService.verifyToken;
    const originalHasAccess = authService.hasProjectAccess;
    const originalCreateWorkspaceBundle = mcpAccessTokenService.createWorkspaceBundle;
    const originalRevokeWorkspaceBundle = mcpAccessTokenService.revokeWorkspaceBundle;
    authService.verifyToken = () => ({ id: 1, email: 'owner@example.com', name: 'Owner' });
    authService.hasProjectAccess = async (_userId, _projectId, role) => role === 'owner';
    const bundleId = '123e4567-e89b-12d3-a456-426614174000';
    mcpAccessTokenService.createWorkspaceBundle = async () => { throw new ActiveMcpWorkspaceBundleError(bundleId); };
    mcpAccessTokenService.revokeWorkspaceBundle = async (projectId, receivedBundleId) => ({ project_id: projectId, bundle_id: receivedBundleId, revoked: 7 } as any);

    const app = Fastify();
    app.register(projectRoutes);
    try {
        const duplicate = await app.inject({
            method: 'POST', url: '/api/projects/10/mcp/workspace-access',
            headers: { authorization: 'Bearer mock-token' }, payload: { userId: 22 }
        });
        assert.equal(duplicate.statusCode, 409);
        assert.equal(JSON.parse(duplicate.body).bundle_id, bundleId);

        const revoked = await app.inject({
            method: 'DELETE', url: `/api/projects/10/mcp/workspace-access/${bundleId}`,
            headers: { authorization: 'Bearer mock-token' }
        });
        assert.equal(revoked.statusCode, 200);
        assert.equal(JSON.parse(revoked.body).revoked, 7);
    } finally {
        authService.verifyToken = originalVerifyToken;
        authService.hasProjectAccess = originalHasAccess;
        mcpAccessTokenService.createWorkspaceBundle = originalCreateWorkspaceBundle;
        mcpAccessTokenService.revokeWorkspaceBundle = originalRevokeWorkspaceBundle;
    }
});

test('cleanAndFormatHashtags removes duplicate and double hashtags', () => {
    const text = 'Hello world ##tech #programming. This is an awesome post!';
    const tags = ['tech', 'programming', 'typescript'];
    const category = 'Development';

    const result = cleanAndFormatHashtags(text, tags, category);

    // It should strip existing double hashes in body: ##tech -> #tech
    assert.match(result, /#tech/);
    assert.ok(!result.includes('##tech'));

    // It should append 'typescript' but NOT append 'tech' and 'programming' again since they are in body
    assert.match(result, /#typescript/);
    
    // Check total occurrence counts:
    const appendedPart = result.split('!').pop() || '';
    assert.ok(!appendedPart.includes('#tech'), 'Appended tags should not contain duplicates of body tech');
    assert.ok(!appendedPart.includes('#programming'), 'Appended tags should not contain duplicates of body programming');
    assert.ok(appendedPart.includes('#typescript'), 'New tags should be appended');
});

test('cleanAndFormatHashtags handles category fallback tag', () => {
    const text = 'Some content';
    const result = cleanAndFormatHashtags(text, [], 'Soft Skills');
    
    assert.equal(result, 'Some content\n\n#SoftSkills');
});

test('generateSlots uses explicit channelId when provided', async () => {
    const originalCreateMany = prisma.post.createMany;
    const originalFindUniqueChannel = prisma.socialChannel.findUnique;
    
    let createdPosts: any[] = [];
    Object.defineProperty(prisma.post, 'createMany', {
        value: async (args: any) => {
            createdPosts = args.data;
            return { count: args.data.length };
        },
        configurable: true,
        writable: true
    });

    Object.defineProperty(prisma.socialChannel, 'findUnique', {
        value: async () => ({
            id: 42,
            type: 'vk',
            name: 'VK Target'
        }),
        configurable: true,
        writable: true
    });

    try {
        await plannerService.generateSlots(1, 1, new Date(), 14, 0, 42);
        
        assert.equal(createdPosts.length, 14);
        for (const post of createdPosts) {
            assert.equal(post.channel_id, 42);
        }
    } finally {
        Object.defineProperty(prisma.post, 'createMany', {
            value: originalCreateMany,
            configurable: true,
            writable: true
        });
        Object.defineProperty(prisma.socialChannel, 'findUnique', {
            value: originalFindUniqueChannel,
            configurable: true,
            writable: true
        });
    }
});
