"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const vk_oauth_service_1 = require("../services/vk_oauth.service");
const channel_utils_1 = require("../utils/channel.utils");
const TEST_SECRET = 'test-only-channel-secret-key-at-least-32-characters';
function withVkEnvironment(run) {
    const previous = {
        key: process.env.CHANNEL_SECRETS_KEY,
        clientId: process.env.VK_CLIENT_ID,
        redirectUri: process.env.VK_REDIRECT_URI
    };
    process.env.CHANNEL_SECRETS_KEY = TEST_SECRET;
    process.env.VK_CLIENT_ID = '54753800';
    process.env.VK_REDIRECT_URI = 'https://planner.example/api/integrations/vk/callback';
    return Promise.resolve(run()).finally(() => {
        if (previous.key === undefined)
            delete process.env.CHANNEL_SECRETS_KEY;
        else
            process.env.CHANNEL_SECRETS_KEY = previous.key;
        if (previous.clientId === undefined)
            delete process.env.VK_CLIENT_ID;
        else
            process.env.VK_CLIENT_ID = previous.clientId;
        if (previous.redirectUri === undefined)
            delete process.env.VK_REDIRECT_URI;
        else
            process.env.VK_REDIRECT_URI = previous.redirectUri;
    });
}
(0, node_test_1.default)('VK OAuth authorization uses PKCE and binds encrypted state to owner and channel', async () => {
    await withVkEnvironment(() => {
        const service = new vk_oauth_service_1.VkOAuthService();
        const result = service.createAuthorization({ projectId: 10, channelId: 117, userId: 1 });
        const url = new URL(result.authorizationUrl);
        strict_1.default.equal(url.origin, 'https://id.vk.ru');
        strict_1.default.equal(url.pathname, '/authorize');
        strict_1.default.equal(url.searchParams.get('client_id'), '54753800');
        strict_1.default.equal(url.searchParams.get('response_type'), 'code');
        strict_1.default.equal(url.searchParams.get('code_challenge_method'), 'S256');
        strict_1.default.match(url.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/);
        strict_1.default.equal(url.searchParams.get('redirect_uri'), 'https://planner.example/api/integrations/vk/callback');
        strict_1.default.match(result.state, /^[A-Za-z0-9_-]+$/);
        strict_1.default.equal(result.state.includes(':'), false);
        strict_1.default.equal(result.authorizationUrl.includes('verifier'), false);
        const state = service.readState(result.state);
        strict_1.default.equal(state.projectId, 10);
        strict_1.default.equal(state.channelId, 117);
        strict_1.default.equal(state.userId, 1);
        strict_1.default.ok(state.verifier.length >= 43);
    });
});
(0, node_test_1.default)('VK OAuth exchanges the code with the original PKCE verifier and device identity', async () => {
    await withVkEnvironment(async () => {
        const service = new vk_oauth_service_1.VkOAuthService();
        const previousFetch = global.fetch;
        let capturedUrl = '';
        let capturedBody = '';
        global.fetch = (async (input, init) => {
            capturedUrl = String(input);
            capturedBody = String(init?.body || '');
            return new Response(JSON.stringify({ access_token: 'vk-user-token', refresh_token: 'vk-refresh', state: 'state-1' }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        });
        try {
            const token = await service.exchangeCode({ code: 'code-1', deviceId: 'device-1', state: 'state-1', verifier: 'verifier-1' });
            const url = new URL(capturedUrl);
            strict_1.default.equal(url.origin, 'https://id.vk.ru');
            strict_1.default.equal(url.searchParams.get('grant_type'), 'authorization_code');
            strict_1.default.equal(url.searchParams.get('device_id'), 'device-1');
            strict_1.default.equal(url.searchParams.get('code_verifier'), 'verifier-1');
            strict_1.default.equal(capturedBody, 'code=code-1');
            strict_1.default.equal(token.access_token, 'vk-user-token');
        }
        finally {
            global.fetch = previousFetch;
        }
    });
});
(0, node_test_1.default)('VK OAuth accepts only a profile that administers the configured community', async () => {
    await withVkEnvironment(async () => {
        const service = new vk_oauth_service_1.VkOAuthService();
        const previousFetch = global.fetch;
        global.fetch = (async (input) => {
            const url = new URL(String(input));
            const response = url.pathname.endsWith('/users.get')
                ? [{ id: 42 }]
                : { items: [117, 999] };
            return new Response(JSON.stringify({ response }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        try {
            strict_1.default.deepEqual(await service.verifyCommunityAdmin('token', '-117'), { userId: 42, communityId: '117' });
            await strict_1.default.rejects(() => service.verifyCommunityAdmin('token', '-118'), /not an administrator/);
        }
        finally {
            global.fetch = previousFetch;
        }
    });
});
(0, node_test_1.default)('VK OAuth tokens are encrypted at rest, masked in API output, and preserved on edits', async () => {
    await withVkEnvironment(() => {
        const stored = (0, channel_utils_1.prepareChannelConfigForStorage)('vk', {
            vk_id: '-117',
            publish_access_token: 'publish-secret',
            stats_access_token: 'stats-secret',
            vk_refresh_token: 'refresh-secret'
        });
        strict_1.default.equal(JSON.stringify(stored).includes('publish-secret'), false);
        strict_1.default.match(stored.publish_access_token_encrypted, /^enc:v1:/);
        strict_1.default.match(stored.stats_access_token_encrypted, /^enc:v1:/);
        strict_1.default.match(stored.vk_refresh_token_encrypted, /^enc:v1:/);
        const sanitized = (0, channel_utils_1.sanitizeChannelConfig)('vk', stored);
        strict_1.default.equal(sanitized.publish_access_token, '******');
        strict_1.default.equal(sanitized.stats_access_token, '******');
        strict_1.default.equal(sanitized.vk_refresh_token, '******');
        strict_1.default.equal(sanitized.publish_access_token_encrypted, undefined);
        const merged = (0, channel_utils_1.mergeChannelConfig)({ vk_id: '-117', publish_access_token: '******' }, stored);
        const resolved = (0, channel_utils_1.resolveEffectiveChannelConfig)('vk', merged);
        strict_1.default.equal(resolved.publish_access_token, 'publish-secret');
        strict_1.default.equal(resolved.stats_access_token, 'stats-secret');
        strict_1.default.equal(resolved.vk_refresh_token, 'refresh-secret');
    });
});
