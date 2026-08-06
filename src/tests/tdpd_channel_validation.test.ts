import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// Import our utility functions
import { sanitizeChannelConfig, mergeChannelConfig } from '../utils/channel.utils';
import projectRoutes from '../routes/project.routes';
import authService from '../services/auth.service';
import { prisma } from '../services/planner.service';

test('sanitizeChannelConfig masks sensitive fields', () => {
    const config = {
        telegram_channel_id: '-100123456',
        channel_username: '@mychannel',
        api_key: 'super-secret-vk-key',
        access_token: 'threads-token',
        cookies: 'session=abc',
        application_secret_key: 'ok-app-secret'
    };

    const sanitized = sanitizeChannelConfig('telegram', config);

    assert.equal(sanitized.telegram_channel_id, '-100123456');
    assert.equal(sanitized.channel_username, '@mychannel');
    assert.equal(sanitized.api_key, '******');
    assert.equal(sanitized.access_token, '******');
    assert.equal(sanitized.cookies, '******');
    assert.equal(sanitized.application_secret_key, '******');
});

test('mergeChannelConfig preserves existing secrets when incoming is masked', () => {
    const existingConfig = {
        api_key: 'original-vk-key',
        access_token: 'original-threads-token',
        cookies: 'original-session',
        application_secret_key: 'original-ok-secret'
    };

    const incomingConfig = {
        telegram_channel_id: '-100999888',
        api_key: '******',
        access_token: '******',
        cookies: '******',
        application_secret_key: '******'
    };

    const merged = mergeChannelConfig(incomingConfig, existingConfig);

    assert.equal(merged.telegram_channel_id, '-100999888');
    assert.equal(merged.api_key, 'original-vk-key');
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
