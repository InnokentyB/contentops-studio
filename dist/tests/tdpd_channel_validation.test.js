"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fastify_1 = __importDefault(require("fastify"));
// Import our utility functions
const channel_utils_1 = require("../utils/channel.utils");
const project_routes_1 = __importDefault(require("../routes/project.routes"));
const auth_service_1 = __importDefault(require("../services/auth.service"));
const planner_service_1 = require("../services/planner.service");
(0, node_test_1.default)('sanitizeChannelConfig masks sensitive fields', () => {
    const config = {
        telegram_channel_id: '-100123456',
        channel_username: '@mychannel',
        api_key: 'super-secret-vk-key',
        access_token: 'threads-token',
        cookies: 'session=abc',
        application_secret_key: 'ok-app-secret'
    };
    const sanitized = (0, channel_utils_1.sanitizeChannelConfig)('telegram', config);
    strict_1.default.equal(sanitized.telegram_channel_id, '-100123456');
    strict_1.default.equal(sanitized.channel_username, '@mychannel');
    strict_1.default.equal(sanitized.api_key, '******');
    strict_1.default.equal(sanitized.access_token, '******');
    strict_1.default.equal(sanitized.cookies, '******');
    strict_1.default.equal(sanitized.application_secret_key, '******');
});
(0, node_test_1.default)('mergeChannelConfig preserves existing secrets when incoming is masked', () => {
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
    const merged = (0, channel_utils_1.mergeChannelConfig)(incomingConfig, existingConfig);
    strict_1.default.equal(merged.telegram_channel_id, '-100999888');
    strict_1.default.equal(merged.api_key, 'original-vk-key');
    strict_1.default.equal(merged.access_token, 'original-threads-token');
    strict_1.default.equal(merged.cookies, 'original-session');
    strict_1.default.equal(merged.application_secret_key, 'original-ok-secret');
});
(0, node_test_1.default)('mergeChannelConfig updates secrets when incoming has actual new values', () => {
    const existingConfig = {
        api_key: 'original-vk-key',
        access_token: 'original-threads-token'
    };
    const incomingConfig = {
        api_key: 'new-vk-key',
        access_token: '******'
    };
    const merged = (0, channel_utils_1.mergeChannelConfig)(incomingConfig, existingConfig);
    strict_1.default.equal(merged.api_key, 'new-vk-key');
    strict_1.default.equal(merged.access_token, 'original-threads-token');
});
(0, node_test_1.default)('GET /api/projects/:id masks secrets', async () => {
    // 1. Mock auth checks
    const originalVerifyToken = auth_service_1.default.verifyToken;
    const originalHasAccess = auth_service_1.default.hasProjectAccess;
    auth_service_1.default.verifyToken = () => ({ id: 1, email: 'test@example.com', name: 'Test' });
    auth_service_1.default.hasProjectAccess = async () => true;
    // 2. Mock prisma.project.findUnique
    const originalFindUnique = planner_service_1.prisma.project.findUnique;
    Object.defineProperty(planner_service_1.prisma.project, 'findUnique', {
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
    const app = (0, fastify_1.default)();
    app.register(project_routes_1.default);
    try {
        const response = await app.inject({
            method: 'GET',
            url: '/api/projects/1',
            headers: {
                authorization: 'Bearer mock-token'
            }
        });
        strict_1.default.equal(response.statusCode, 200);
        const data = JSON.parse(response.body);
        strict_1.default.equal(data.channels[0].config.api_key, '******');
        strict_1.default.equal(data.channels[0].config.vk_id, '-999');
    }
    finally {
        auth_service_1.default.verifyToken = originalVerifyToken;
        auth_service_1.default.hasProjectAccess = originalHasAccess;
        Object.defineProperty(planner_service_1.prisma.project, 'findUnique', {
            value: originalFindUnique,
            configurable: true,
            writable: true
        });
    }
});
(0, node_test_1.default)('PUT /api/projects/:id/channels/:channelId merges configs', async () => {
    // 1. Mock auth checks
    const originalVerifyToken = auth_service_1.default.verifyToken;
    const originalHasAccess = auth_service_1.default.hasProjectAccess;
    auth_service_1.default.verifyToken = () => ({ id: 1, email: 'test@example.com', name: 'Test' });
    auth_service_1.default.hasProjectAccess = async () => true;
    // 2. Mock prisma.socialChannel.findUnique and prisma.socialChannel.update
    const originalFindUniqueChannel = planner_service_1.prisma.socialChannel.findUnique;
    const originalUpdateChannel = planner_service_1.prisma.socialChannel.update;
    Object.defineProperty(planner_service_1.prisma.socialChannel, 'findUnique', {
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
    let updatedConfig = null;
    Object.defineProperty(planner_service_1.prisma.socialChannel, 'update', {
        value: async (args) => {
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
    const app = (0, fastify_1.default)();
    app.register(project_routes_1.default);
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
        strict_1.default.equal(response.statusCode, 200);
        // Verify merge was called and original secret VK api_key is preserved in database call
        strict_1.default.equal(updatedConfig.api_key, 'super-secret-key-123');
        // Verify response returned to user is sanitized (masked)
        const data = JSON.parse(response.body);
        strict_1.default.equal(data.config.api_key, '******');
    }
    finally {
        auth_service_1.default.verifyToken = originalVerifyToken;
        auth_service_1.default.hasProjectAccess = originalHasAccess;
        Object.defineProperty(planner_service_1.prisma.socialChannel, 'findUnique', {
            value: originalFindUniqueChannel,
            configurable: true,
            writable: true
        });
        Object.defineProperty(planner_service_1.prisma.socialChannel, 'update', {
            value: originalUpdateChannel,
            configurable: true,
            writable: true
        });
    }
});
