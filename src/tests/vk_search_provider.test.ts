import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import { VkSearchService } from '../services/vk_search.service';
import { searchVkPublicPosts } from '../services/vk_search/provider';

const input = { projectId: 10, actorId: 'user:2', channelId: 117, routes: [{ route: 'a', queries: ['агента'] }], since: '2026-10-01T00:00:00Z' };

test('production channel lookup enforces active VK channel in authorized project before search', async context => {
    const memberLookup = prisma.projectMember.findUnique;
    const channelLookup = prisma.socialChannel.findFirst;
    let lookup: unknown;
    Object.defineProperty(prisma.projectMember, 'findUnique', { configurable: true, value: async () => ({ id: 1 }) });
    Object.defineProperty(prisma.socialChannel, 'findFirst', { configurable: true, value: async (query: unknown) => { lookup = query; return null; } });
    context.mock.method(globalThis, 'fetch', async () => { assert.fail('provider called for missing/wrong-tenant channel'); });
    try {
        const result = await new VkSearchService().searchRelevantPosts(input);
        assert.deepEqual(lookup, { where: { id: 117, project_id: 10, is_active: true, type: 'vk' }, select: { config: true } });
        assert.equal(result.queries[0].reason, 'ACTIVE_VK_CHANNEL_NOT_FOUND');
    } finally {
        Object.defineProperty(prisma.projectMember, 'findUnique', { configurable: true, value: memberLookup });
        Object.defineProperty(prisma.socialChannel, 'findFirst', { configurable: true, value: channelLookup });
    }
});

test('provider transport uses fixed read method, body credentials, timeout and no redirects', async context => {
    context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
        assert.equal(url, 'https://api.vk.com/method/newsfeed.search');
        assert.equal(String(url).includes('test-token'), false);
        assert.equal(init?.method, 'POST');
        assert.equal(init?.redirect, 'error');
        assert.ok(init?.signal);
        assert.ok(init?.body instanceof URLSearchParams);
        assert.equal(init.body.get('access_token'), 'test-token');
        assert.equal(init.body.get('v'), '5.199');
        assert.equal(init.body.get('q'), 'агента');
        return new Response(JSON.stringify({ response: { items: [] } }));
    });
    assert.deepEqual(await searchVkPublicPosts('test-token', { q: 'агента' }), { response: { items: [] } });
});

test('oversized and non-JSON provider responses are rejected', async context => {
    const mock = context.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    await assert.rejects(searchVkPublicPosts('test-token', { q: 'агента' }), /RESPONSE_TOO_LARGE/);
    mock.mock.mockImplementation(async () => new Response('<html>challenge</html>'));
    await assert.rejects(searchVkPublicPosts('test-token', { q: 'агента' }), SyntaxError);
});
