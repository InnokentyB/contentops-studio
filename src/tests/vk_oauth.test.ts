import test from 'node:test';
import assert from 'node:assert/strict';
import { VkOAuthService } from '../services/vk_oauth.service';
import {
    mergeChannelConfig,
    prepareChannelConfigForStorage,
    resolveEffectiveChannelConfig,
    sanitizeChannelConfig
} from '../utils/channel.utils';

const TEST_SECRET = 'test-only-channel-secret-key-at-least-32-characters';

function withVkEnvironment(run: () => Promise<void> | void) {
    const previous = {
        key: process.env.CHANNEL_SECRETS_KEY,
        clientId: process.env.VK_CLIENT_ID,
        redirectUri: process.env.VK_REDIRECT_URI
    };
    process.env.CHANNEL_SECRETS_KEY = TEST_SECRET;
    process.env.VK_CLIENT_ID = '54753800';
    process.env.VK_REDIRECT_URI = 'https://planner.example/api/integrations/vk/callback';
    return Promise.resolve(run()).finally(() => {
        if (previous.key === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = previous.key;
        if (previous.clientId === undefined) delete process.env.VK_CLIENT_ID;
        else process.env.VK_CLIENT_ID = previous.clientId;
        if (previous.redirectUri === undefined) delete process.env.VK_REDIRECT_URI;
        else process.env.VK_REDIRECT_URI = previous.redirectUri;
    });
}

test('VK OAuth authorization uses PKCE and binds encrypted state to owner and channel', async () => {
    await withVkEnvironment(() => {
        const service = new VkOAuthService();
        const result = service.createAuthorization({ projectId: 10, channelId: 117, userId: 1 });
        const url = new URL(result.authorizationUrl);

        assert.equal(url.origin, 'https://id.vk.ru');
        assert.equal(url.pathname, '/authorize');
        assert.equal(url.searchParams.get('client_id'), '54753800');
        assert.equal(url.searchParams.get('response_type'), 'code');
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.match(url.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/);
        assert.equal(url.searchParams.get('redirect_uri'), 'https://planner.example/api/integrations/vk/callback');
        assert.ok((url.searchParams.get('scope') || '').split(' ').includes('stories'));
        assert.match(result.state, /^[A-Za-z0-9_-]+$/);
        assert.equal(result.state.includes(':'), false);
        assert.equal(result.authorizationUrl.includes('verifier'), false);

        const state = service.readState(result.state);
        assert.equal(state.projectId, 10);
        assert.equal(state.channelId, 117);
        assert.equal(state.userId, 1);
        assert.ok(state.verifier.length >= 43);
    });
});

test('VK OAuth exchanges the code with the original PKCE verifier and device identity', async () => {
    await withVkEnvironment(async () => {
        const service = new VkOAuthService();
        const previousFetch = global.fetch;
        let capturedUrl = '';
        let capturedBody = '';
        global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            capturedUrl = String(input);
            capturedBody = String(init?.body || '');
            return new Response(JSON.stringify({ access_token: 'vk-user-token', refresh_token: 'vk-refresh', state: 'state-1' }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }) as typeof fetch;
        try {
            const token = await service.exchangeCode({ code: 'code-1', deviceId: 'device-1', state: 'state-1', verifier: 'verifier-1' });
            const url = new URL(capturedUrl);
            assert.equal(url.origin, 'https://id.vk.ru');
            assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
            assert.equal(url.searchParams.get('device_id'), 'device-1');
            assert.equal(url.searchParams.get('code_verifier'), 'verifier-1');
            assert.equal(capturedBody, 'code=code-1');
            assert.equal(token.access_token, 'vk-user-token');
        } finally {
            global.fetch = previousFetch;
        }
    });
});

test('VK OAuth accepts only a profile that administers the configured community', async () => {
    await withVkEnvironment(async () => {
        const service = new VkOAuthService();
        const previousFetch = global.fetch;
        global.fetch = (async (input: string | URL | Request) => {
            const url = new URL(String(input));
            const response = url.pathname.endsWith('/users.get')
                ? [{ id: 42 }]
                : { groups: [{ id: 117, is_admin: 1, admin_level: 3 }] };
            return new Response(JSON.stringify({ response }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        try {
            assert.deepEqual(await service.verifyCommunityAdmin('token', '-117'), { userId: 42, communityId: '117' });
            await assert.rejects(() => service.verifyCommunityAdmin('token', '-118'), /not an administrator/);
        } finally {
            global.fetch = previousFetch;
        }
    });
});

test('VK OAuth uses the VK ID identity and supports the legacy getById response shape', async () => {
    await withVkEnvironment(async () => {
        const service = new VkOAuthService();
        const previousFetch = global.fetch;
        const methods: string[] = [];
        global.fetch = (async (input: string | URL | Request) => {
            const url = new URL(String(input));
            methods.push(url.pathname.split('/').pop() || '');
            return new Response(JSON.stringify({ response: [{ id: 117, is_admin: 0, admin_level: 2 }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }) as typeof fetch;
        try {
            assert.deepEqual(await service.verifyCommunityAdmin('token', '-117', 42), { userId: 42, communityId: '117' });
            assert.deepEqual(methods, ['groups.getById']);
        } finally {
            global.fetch = previousFetch;
        }
    });
});

test('VK OAuth verification errors identify the failed API method without exposing the token', async () => {
    await withVkEnvironment(async () => {
        const service = new VkOAuthService();
        const previousFetch = global.fetch;
        global.fetch = (async () => new Response(JSON.stringify({
            error: { error_msg: 'Method is not available for this profile type' }
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
        try {
            await assert.rejects(
                () => service.verifyCommunityAdmin('secret-token', '-117', 42),
                (error: Error) => error.message.includes('VK API groups.getById') && !error.message.includes('secret-token')
            );
        } finally {
            global.fetch = previousFetch;
        }
    });
});

test('VK OAuth tokens are encrypted at rest, masked in API output, and preserved on edits', async () => {
    await withVkEnvironment(() => {
        const stored = prepareChannelConfigForStorage('vk', {
            vk_id: '-117',
            publish_access_token: 'publish-secret',
            stats_access_token: 'stats-secret',
            vk_refresh_token: 'refresh-secret'
        });
        assert.equal(JSON.stringify(stored).includes('publish-secret'), false);
        assert.match(stored.publish_access_token_encrypted, /^enc:v1:/);
        assert.match(stored.stats_access_token_encrypted, /^enc:v1:/);
        assert.match(stored.vk_refresh_token_encrypted, /^enc:v1:/);

        const sanitized = sanitizeChannelConfig('vk', stored);
        assert.equal(sanitized.publish_access_token, '******');
        assert.equal(sanitized.stats_access_token, '******');
        assert.equal(sanitized.vk_refresh_token, '******');
        assert.equal(sanitized.publish_access_token_encrypted, undefined);

        const merged = mergeChannelConfig({ vk_id: '-117', publish_access_token: '******' }, stored);
        const resolved = resolveEffectiveChannelConfig('vk', merged);
        assert.equal(resolved.publish_access_token, 'publish-secret');
        assert.equal(resolved.stats_access_token, 'stats-secret');
        assert.equal(resolved.vk_refresh_token, 'refresh-secret');
    });
});
