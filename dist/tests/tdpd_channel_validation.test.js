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
const planner_service_2 = __importDefault(require("../services/planner.service"));
(0, node_test_1.default)('sanitizeChannelConfig masks sensitive fields', () => {
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
    const sanitized = (0, channel_utils_1.sanitizeChannelConfig)('telegram', config);
    strict_1.default.equal(sanitized.telegram_channel_id, '-100123456');
    strict_1.default.equal(sanitized.channel_username, '@mychannel');
    strict_1.default.equal(sanitized.api_key, '******');
    strict_1.default.equal(sanitized.publish_access_token, '******');
    strict_1.default.equal(sanitized.stats_access_token, '******');
    strict_1.default.equal(sanitized.access_token, '******');
    strict_1.default.equal(sanitized.cookies, '******');
    strict_1.default.equal(sanitized.application_secret_key, '******');
});
(0, node_test_1.default)('mergeChannelConfig preserves existing secrets when incoming is masked', () => {
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
    const merged = (0, channel_utils_1.mergeChannelConfig)(incomingConfig, existingConfig);
    strict_1.default.equal(merged.telegram_channel_id, '-100999888');
    strict_1.default.equal(merged.api_key, 'original-vk-key');
    strict_1.default.equal(merged.publish_access_token, 'original-vk-publish-token');
    strict_1.default.equal(merged.stats_access_token, 'original-vk-stats-token');
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
(0, node_test_1.default)('Dzen session cookies are encrypted at rest and masked in API responses', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-only-channel-secret-key';
    try {
        const stored = (0, channel_utils_1.prepareChannelConfigForStorage)('zen', {
            channel_id: 'channel-1',
            cookies: 'Session_id=secret-session; yandexuid=123'
        });
        strict_1.default.equal(stored.cookies, undefined);
        strict_1.default.match(stored.cookies_encrypted, /^enc:v1:/);
        strict_1.default.equal(JSON.stringify(stored).includes('secret-session'), false);
        const sanitized = (0, channel_utils_1.sanitizeChannelConfig)('zen', stored);
        strict_1.default.equal(sanitized.cookies, '******');
        strict_1.default.equal(sanitized.cookies_encrypted, undefined);
        const resolved = (0, channel_utils_1.resolveChannelConfigSecrets)('zen', stored);
        strict_1.default.equal(resolved.cookies, 'Session_id=secret-session; yandexuid=123');
        strict_1.default.equal(resolved.cookies_encrypted, undefined);
    }
    finally {
        if (previousKey === undefined)
            delete process.env.CHANNEL_SECRETS_KEY;
        else
            process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});
(0, node_test_1.default)('Dzen credentials nested in raw_account are also encrypted and redacted', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-only-channel-secret-key';
    try {
        const stored = (0, channel_utils_1.prepareChannelConfigForStorage)('dzen', {
            platform: 'dzen',
            raw_account: { channel_id: 'nested', cookies: 'Session_id=nested-secret' }
        });
        strict_1.default.equal(stored.raw_account.cookies, undefined);
        strict_1.default.match(stored.raw_account.cookies_encrypted, /^enc:v1:/);
        const sanitized = (0, channel_utils_1.sanitizeChannelConfig)('dzen', stored);
        strict_1.default.equal(sanitized.raw_account.cookies, '******');
        strict_1.default.equal(sanitized.raw_account.cookies_encrypted, undefined);
    }
    finally {
        if (previousKey === undefined)
            delete process.env.CHANNEL_SECRETS_KEY;
        else
            process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
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
(0, node_test_1.default)('PUT /api/projects/:id/channels/:channelId requires project owner', async () => {
    const originalVerifyToken = auth_service_1.default.verifyToken;
    const originalHasAccess = auth_service_1.default.hasProjectAccess;
    let requestedRole;
    auth_service_1.default.verifyToken = () => ({ id: 2, email: 'editor@example.com', name: 'Editor' });
    auth_service_1.default.hasProjectAccess = async (_userId, _projectId, role) => {
        requestedRole = role;
        return false;
    };
    const app = (0, fastify_1.default)();
    app.register(project_routes_1.default);
    try {
        const response = await app.inject({
            method: 'PUT',
            url: '/api/projects/1/channels/10',
            headers: { authorization: 'Bearer mock-token' },
            payload: { name: 'Blocked update', config: { workflow_mode: 'auto_publish' } }
        });
        strict_1.default.equal(requestedRole, 'owner');
        strict_1.default.equal(response.statusCode, 403);
    }
    finally {
        auth_service_1.default.verifyToken = originalVerifyToken;
        auth_service_1.default.hasProjectAccess = originalHasAccess;
    }
});
(0, node_test_1.default)('mergeChannelConfig keeps channel workflow mode', () => {
    const merged = (0, channel_utils_1.mergeChannelConfig)({ workflow_mode: 'approval_required' }, { workflow_mode: 'prepare_only', api_key: 'secret' });
    strict_1.default.equal(merged.workflow_mode, 'approval_required');
});
(0, node_test_1.default)('GET /api/projects/:id/mcp/status reports the configured MCP health', async () => {
    const originalVerifyToken = auth_service_1.default.verifyToken;
    const originalHasAccess = auth_service_1.default.hasProjectAccess;
    const originalFetch = global.fetch;
    auth_service_1.default.verifyToken = () => ({ id: 1, email: 'owner@example.com', name: 'Owner' });
    auth_service_1.default.hasProjectAccess = async (_userId, _projectId, role) => role === 'owner';
    global.fetch = async () => new Response(JSON.stringify({
        status: 'ok', transport: 'streamable-http', auth: { bearer_required: false }, uptime_s: 12, active_sessions: 1,
        capability_endpoints: {
            planner: { configured: true, project_id: 1, user_id: 1 },
            writer: { configured: true, project_id: 1, user_id: 1 }
        }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const app = (0, fastify_1.default)();
    app.register(project_routes_1.default);
    try {
        const response = await app.inject({ method: 'GET', url: '/api/projects/1/mcp/status', headers: { authorization: 'Bearer mock-token' } });
        strict_1.default.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        strict_1.default.equal(body.status, 'online');
        strict_1.default.equal(body.bearer_required, false);
        strict_1.default.equal(body.transport, 'streamable-http');
        strict_1.default.equal(body.capability_endpoints.planner.configured, true);
        strict_1.default.match(body.capability_endpoints.planner.endpoint, /\/mcp\/planner$/);
        strict_1.default.equal(body.capability_endpoints.writer.configured, true);
    }
    finally {
        auth_service_1.default.verifyToken = originalVerifyToken;
        auth_service_1.default.hasProjectAccess = originalHasAccess;
        global.fetch = originalFetch;
    }
});
(0, node_test_1.default)('cleanAndFormatHashtags removes duplicate and double hashtags', () => {
    const text = 'Hello world ##tech #programming. This is an awesome post!';
    const tags = ['tech', 'programming', 'typescript'];
    const category = 'Development';
    const result = (0, channel_utils_1.cleanAndFormatHashtags)(text, tags, category);
    // It should strip existing double hashes in body: ##tech -> #tech
    strict_1.default.match(result, /#tech/);
    strict_1.default.ok(!result.includes('##tech'));
    // It should append 'typescript' but NOT append 'tech' and 'programming' again since they are in body
    strict_1.default.match(result, /#typescript/);
    // Check total occurrence counts:
    const appendedPart = result.split('!').pop() || '';
    strict_1.default.ok(!appendedPart.includes('#tech'), 'Appended tags should not contain duplicates of body tech');
    strict_1.default.ok(!appendedPart.includes('#programming'), 'Appended tags should not contain duplicates of body programming');
    strict_1.default.ok(appendedPart.includes('#typescript'), 'New tags should be appended');
});
(0, node_test_1.default)('cleanAndFormatHashtags handles category fallback tag', () => {
    const text = 'Some content';
    const result = (0, channel_utils_1.cleanAndFormatHashtags)(text, [], 'Soft Skills');
    strict_1.default.equal(result, 'Some content\n\n#SoftSkills');
});
(0, node_test_1.default)('generateSlots uses explicit channelId when provided', async () => {
    const originalCreateMany = planner_service_1.prisma.post.createMany;
    const originalFindUniqueChannel = planner_service_1.prisma.socialChannel.findUnique;
    let createdPosts = [];
    Object.defineProperty(planner_service_1.prisma.post, 'createMany', {
        value: async (args) => {
            createdPosts = args.data;
            return { count: args.data.length };
        },
        configurable: true,
        writable: true
    });
    Object.defineProperty(planner_service_1.prisma.socialChannel, 'findUnique', {
        value: async () => ({
            id: 42,
            type: 'vk',
            name: 'VK Target'
        }),
        configurable: true,
        writable: true
    });
    try {
        await planner_service_2.default.generateSlots(1, 1, new Date(), 14, 0, 42);
        strict_1.default.equal(createdPosts.length, 14);
        for (const post of createdPosts) {
            strict_1.default.equal(post.channel_id, 42);
        }
    }
    finally {
        Object.defineProperty(planner_service_1.prisma.post, 'createMany', {
            value: originalCreateMany,
            configurable: true,
            writable: true
        });
        Object.defineProperty(planner_service_1.prisma.socialChannel, 'findUnique', {
            value: originalFindUniqueChannel,
            configurable: true,
            writable: true
        });
    }
});
