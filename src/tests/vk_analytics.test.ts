import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import vkService, {
    chunkVkPostIds,
    calculateVkMetricDelta,
    normalizeVkOwnerId,
    parseVkPostIdentity
} from '../services/vk.service';

test('VK owner ID is normalized to a negative community ID', () => {
    assert.equal(normalizeVkOwnerId('123456'), '-123456');
    assert.equal(normalizeVkOwnerId('-123456'), '-123456');
    assert.throws(() => normalizeVkOwnerId('not-an-id'), /Invalid VK community ID/);
});

test('VK permalink is parsed into stable owner and post IDs', () => {
    assert.deepEqual(parseVkPostIdentity('https://vk.com/wall-123456_789'), {
        ownerId: '-123456',
        postId: '789'
    });
    assert.equal(parseVkPostIdentity('https://vk.com/feed'), null);
});

test('VK post IDs are split into API batches of at most 30', () => {
    const ids = Array.from({ length: 65 }, (_, index) => String(index + 1));
    assert.deepEqual(chunkVkPostIds(ids).map((batch) => batch.length), [30, 30, 5]);
});

test('VK batch collection sends post reach requests in groups of 30', async (t: TestContext) => {
    const reachBatchSizes: number[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/wall.getById')) {
            const postId = url.searchParams.get('posts')?.split('_').pop() || '0';
            return new Response(JSON.stringify({
                response: [{ id: Number(postId), owner_id: -10, views: { count: Number(postId) } }]
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        const postIds = (url.searchParams.get('post_ids') || '').split(',').filter(Boolean);
        reachBatchSizes.push(postIds.length);
        return new Response(JSON.stringify({
            response: postIds.map((postId) => ({ post_id: Number(postId), reach_total: Number(postId) * 10 }))
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const ids = Array.from({ length: 65 }, (_, index) => String(index + 1));
    const results = await vkService.collectPostsMetrics('-10', 'publish-token', ids, 'stats-token');

    assert.deepEqual(reachBatchSizes, [30, 30, 5]);
    assert.equal(results.length, 65);
    assert.equal(results[64].metrics.reachTotal, 650);
});

test('VK full metric collection merges public and post reach metrics', async (t: TestContext) => {
    const requests: URL[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = new URL(String(input));
        requests.push(url);

        if (url.pathname.endsWith('/wall.getById')) {
            return new Response(JSON.stringify({
                response: [{
                    id: 789,
                    owner_id: -123456,
                    date: 1786406400,
                    text: 'VK post',
                    views: { count: 1200 },
                    likes: { count: 80 },
                    comments: { count: 12 },
                    reposts: { count: 9 }
                }]
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        return new Response(JSON.stringify({
            response: [{
                post_id: 789,
                reach_total: 900,
                reach_subscribers: 600,
                reach_viral: 250,
                reach_ads: 50,
                links: 40,
                to_group: 15,
                join_group: 4,
                hide: 2,
                report: 1,
                unsubscribe: 3
            }]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await vkService.collectPostMetrics('-123456', 'publish-token', '789', 'stats-token');

    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get('access_token'), 'publish-token');
    assert.equal(requests[1].searchParams.get('access_token'), 'stats-token');
    assert.equal(result.wallStatus, 'collected');
    assert.equal(result.reachStatus, 'collected');
    assert.equal(result.metrics.views, 1200);
    assert.equal(result.metrics.reachTotal, 900);
    assert.equal(result.metrics.linkClicks, 40);
    assert.equal(result.metrics.unsubscribes, 3);
});

test('VK reach failure preserves public metrics and unknown values stay null', async (t: TestContext) => {
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/wall.getById')) {
            return new Response(JSON.stringify({
                response: [{
                    id: 5,
                    owner_id: -10,
                    views: { count: 100 },
                    likes: { count: 8 },
                    comments: { count: 2 },
                    reposts: { count: 1 }
                }]
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        return new Response(JSON.stringify({
            error: { error_code: 15, error_msg: 'Access denied' }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const result = await vkService.collectPostMetrics('-10', 'publish-token', '5', 'forbidden-token');

    assert.equal(result.wallStatus, 'collected');
    assert.equal(result.reachStatus, 'forbidden');
    assert.equal(result.metrics.views, 100);
    assert.equal(result.metrics.reachTotal, null);
    assert.equal(result.providerErrorCode, '15');
});

test('VK weekly delta returns null for missing boundaries and preserves negative adjustments', () => {
    assert.equal(calculateVkMetricDelta(null, 20), null);
    assert.equal(calculateVkMetricDelta(10, null), null);
    assert.equal(calculateVkMetricDelta(100, 80), -20);
    assert.equal(calculateVkMetricDelta(100, 145), 45);
});
