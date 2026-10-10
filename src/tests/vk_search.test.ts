import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { VkSearchService } from '../services/vk_search.service';

const args = { projectId: 10, actorId: 'user:2', channelId: 117,
    routes: [{ route: 'analystcraft', queries: ['приемка агента'] }], since: '2026-10-01T00:00:00Z' };
const now = () => new Date('2026-10-08T12:00:00Z');
const post = { id: 3, owner_id: -7, from_id: 8, date: 1791374400, text: 'приемка агента на практике', likes: { count: 0 } };

test('VK search is available to research planning roles only', () => {
    for (const role of ['owner', 'planner', 'strategist'] as const) assert.equal(isToolAllowedForProfile(role, 'ba_vk_search_relevant_posts'), true);
    for (const role of ['writer', 'publisher', 'organization_researcher'] as const) assert.equal(isToolAllowedForProfile(role, 'ba_vk_search_relevant_posts'), false);
});

test('operator receives exact fresh public evidence, routes and unknown metrics without writes', async () => {
    const calls: Record<string, string | number>[] = [];
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'test-token' }), now,
        search: async (_token, params) => { calls.push(params); return { response: { items: [post, { ...post, id: 4, date: 1 }, { ...post, id: 5, friends_only: 1 }], groups: [{ id: 7, name: 'Практика' }], profiles: [{ id: 8, first_name: 'Автор' }] } }; } });
    const result = await service.searchRelevantPosts(args);
    assert.equal(result.status, 'evidence_limited');
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].url, 'https://vk.com/wall-7_3');
    assert.equal(result.posts[0].community?.name, 'Практика');
    assert.equal(result.posts[0].author?.id, 8);
    assert.deepEqual(result.posts[0].engagement, { likes: 0, comments: null, reposts: null, views: null });
    assert.equal(calls[0].extended, 1);
    assert.equal(result.owned_activity_status, 'unknown');
});

test('access denial stops before channel or provider access', async () => {
    const service = new VkSearchService({ authorize: async () => { throw new Error('PROJECT_ACCESS_DENIED'); },
        loadChannel: async () => { assert.fail('channel accessed'); }, search: async () => { assert.fail('provider called'); }, now });
    await assert.rejects(service.searchRelevantPosts(args), /PROJECT_ACCESS_DENIED/);
});

test('publishing credentials cannot silently act as search credentials', async () => {
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ publish_access_token: 'secret' }),
        search: async () => { assert.fail('provider called'); }, now });
    const result = await service.searchRelevantPosts(args);
    assert.equal(result.status, 'blocked');
    assert.equal(result.queries[0].reason, 'VK_SEARCH_API_TOKEN_REQUIRED');
});

test('partial routes survive provider denial and raw error secrets never leave boundary', async () => {
    let calls = 0;
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'secret' }), now,
        search: async () => ++calls === 1 ? { response: { items: [post] } } : { error: { error_code: 15, error_msg: 'secret', request_params: [{ access_token: 'secret' }] } } });
    const result = await service.searchRelevantPosts({ ...args, routes: [{ route: 'a', queries: ['агента'] }, { route: 'b', queries: ['приемка'] }] });
    assert.equal(result.posts.length, 1);
    assert.equal(result.queries[1].status, 'blocked');
    assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('malformed provider evidence is unknown and pagination is bounded/deduplicated', async () => {
    let calls = 0;
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'token' }), now,
        search: async () => { calls++; return { response: { items: [post], next_from: 'next' } }; } });
    const result = await service.searchRelevantPosts({ ...args, maxPages: 2 });
    assert.equal(calls, 2);
    assert.equal(result.posts.length, 1);
    assert.equal(result.queries[0].reason, 'PAGE_BUDGET_REACHED');
    const malformed = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'token' }), now, search: async () => ({ response: {} }) });
    assert.equal((await malformed.searchRelevantPosts(args)).queries[0].reason, 'INVALID_PROVIDER_RESPONSE');
});

test('invalid inputs do not call provider', async () => {
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => null, now, search: async () => { assert.fail(); } });
    await assert.rejects(service.searchRelevantPosts({ ...args, since: '2027-01-01T00:00:00Z' }));
    await assert.rejects(service.searchRelevantPosts({ ...args, routes: [{ route: 'a', queries: [' '] }] }));
});

test('duplicates preserve matches across product routes and private communities are excluded', async () => {
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'token' }), now,
        search: async () => ({ response: { items: [post, { ...post, owner_id: -9 }, { ...post, id: 'invalid' }], groups: [{ id: 9, is_closed: 1 }] } }) });
    const result = await service.searchRelevantPosts({ ...args, routes: [{ route: 'a', queries: ['агента'] }, { route: 'b', queries: ['приемка'] }] });
    assert.equal(result.posts.length, 1);
    assert.deepEqual(result.posts[0].matches.map(match => match.route), ['a', 'b']);
    assert.equal(result.queries[0].reason, 'ROWS_FILTERED_OR_INVALID');
});

test('rate limit stops additional routes and no malformed/transport result means zero activity', async () => {
    let calls = 0;
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'token' }), now,
        search: async () => { calls++; return { error: { error_code: 6 } }; } });
    const result = await service.searchRelevantPosts({ ...args, routes: [{ route: 'a', queries: ['агента', 'приемка'] }] });
    assert.equal(calls, 1);
    assert.equal(result.status, 'blocked');
    assert.ok(result.queries.every(query => query.reason === 'VK_RATE_LIMITED'));
    const failed = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'token' }), now,
        search: async () => { throw new Error('secret-cookie-header'); } });
    const failure = await failed.searchRelevantPosts(args);
    assert.equal(failure.status, 'blocked');
    assert.equal(failure.queries[0].reason, 'VK_SEARCH_TRANSPORT_FAILED');
    assert.equal(JSON.stringify(failure).includes('secret-cookie-header'), false);
});

test('valid empty search is distinguished from blocked discovery', async () => {
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => ({ user_access_token: 'token' }), now,
        search: async () => ({ response: { items: [] } }) });
    const result = await service.searchRelevantPosts(args);
    assert.equal(result.status, 'evidence_limited');
    assert.equal(result.queries[0].status, 'searched');
    assert.equal(result.queries[0].reason, null);
    assert.equal(result.owned_activity_status, 'unknown');
});
