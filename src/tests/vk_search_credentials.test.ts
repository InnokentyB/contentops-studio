import test from 'node:test';
import assert from 'node:assert/strict';
import { VkSearchService } from '../services/vk_search.service';
import { prepareChannelConfigForStorage, sanitizeChannelConfig, mergeChannelConfig, resolveEffectiveChannelConfig } from '../utils/channel.utils';

process.env.CHANNEL_SECRETS_KEY = 'vk-search-test-only-encryption-key-32-chars';
const args = { projectId: 10, actorId: 'user:2', channelId: 135,
    routes: [{ route: 'product', queries: ['test search'] }], since: '2026-10-01T00:00:00Z' };
async function search(config: unknown) {
    const tokens: string[] = [];
    const service = new VkSearchService({ authorize: async () => {}, loadChannel: async () => config,
        now: () => new Date('2026-10-10T12:00:00Z'),
        search: async token => { tokens.push(token); return { response: { items: [] } }; } });
    return { result: await service.searchRelevantPosts(args), tokens };
}
test('explicit search API credential wins over legacy user token, without publishing credential fallback', async () => {
    const selected = await search({ search_access_token: 'service-test-key', user_access_token: 'legacy-test-user', publish_access_token: 'publish-test' });
    assert.deepEqual(selected.tokens, ['service-test-key']);
    const fallback = await search({ user_access_token: 'legacy-test-user' });
    assert.deepEqual(fallback.tokens, ['legacy-test-user']);
    const missing = await search({ publish_access_token: 'publish-test', stats_access_token: 'stats-test',
        api_key: 'api-test', vk_oauth_access_token: 'vk2.test', cookies: 'cookie-test' });
    assert.deepEqual(missing.tokens, []);
    assert.equal(missing.result.queries[0].reason, 'VK_SEARCH_API_TOKEN_REQUIRED');
});
test('unsupported explicit credential blocks even with usable legacy fallback and exposes no secret', async () => {
    for (const token of ['vk2.secret-test-value', 'enc:v1:encrypted-test-value', 'test\nsecret']) {
        const blocked = await search({ search_access_token: token, user_access_token: 'legacy-test-user' });
        assert.deepEqual(blocked.tokens, []);
        assert.equal(blocked.result.queries[0].reason, 'VK_SEARCH_TOKEN_KIND_UNSUPPORTED');
        assert.equal(JSON.stringify(blocked.result).includes(token), false);
    }
});
test('search credential stores encrypted, masks plaintext and ciphertext, preserves and rotates independently', () => {
    const stored = prepareChannelConfigForStorage('vk', { search_access_token: 'service-test-original', publish_access_token: 'publish-test-original' });
    assert.equal(stored.search_access_token, undefined);
    assert.match(stored.search_access_token_encrypted, /^enc:v1:/);
    assert.equal(sanitizeChannelConfig('vk', stored).search_access_token, '******');
    assert.equal(sanitizeChannelConfig('vk', stored).search_access_token_encrypted, undefined);
    assert.equal(sanitizeChannelConfig('vk', { search_access_token: 'legacy-test' }).search_access_token, '******');
    for (const config of [{ search_access_token: '******' }, { unrelated: true }]) {
        const preserved = prepareChannelConfigForStorage('vk', mergeChannelConfig(config, stored));
        assert.equal(preserved.search_access_token_encrypted, stored.search_access_token_encrypted);
    }
    const rotated = prepareChannelConfigForStorage('vk', mergeChannelConfig({ search_access_token: 'service-test-rotated' }, stored));
    assert.equal(resolveEffectiveChannelConfig('vk', rotated).search_access_token, 'service-test-rotated');
    assert.equal(rotated.publish_access_token_encrypted, stored.publish_access_token_encrypted);
});
test('nested search credentials are encrypted and masked, preserve masked edits, and current rotation wins', () => {
    const stored = prepareChannelConfigForStorage('vk', { raw_account: { search_access_token: 'nested-test-key' } });
    assert.equal(stored.raw_account.search_access_token, undefined);
    assert.match(stored.raw_account.search_access_token_encrypted, /^enc:v1:/);
    const masked = sanitizeChannelConfig('vk', stored);
    assert.equal(masked.raw_account.search_access_token, '******');
    const preserved = prepareChannelConfigForStorage('vk', mergeChannelConfig(masked, stored));
    assert.equal(resolveEffectiveChannelConfig('vk', preserved).search_access_token, 'nested-test-key');
    const rotated = prepareChannelConfigForStorage('vk', mergeChannelConfig({ search_access_token: 'current-test-key', raw_account: masked.raw_account }, stored));
    assert.equal(resolveEffectiveChannelConfig('vk', rotated).search_access_token, 'current-test-key');
});
test('VK ID search keys are rejected at storage boundary without including token', () => {
    assert.throws(() => prepareChannelConfigForStorage('vk', { search_access_token: 'vk2.secret-test' }), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /VK_SEARCH_TOKEN_KIND_UNSUPPORTED/);
        assert.equal(error.message.includes('secret-test'), false);
        return true;
    });
});

test('encrypted current search credential overrides legacy nested plaintext snapshot', () => {
    const stored = prepareChannelConfigForStorage('vk', { search_access_token: 'current-test-key' });
    const effective = resolveEffectiveChannelConfig('vk', { ...stored, raw_account: { search_access_token: 'legacy-nested-test-key' } });
    assert.equal(effective.search_access_token, 'current-test-key');
});

test('malformed search credential blocks storage and provider calls without fallback', async () => {
    const config = { search_access_token: { invalid: 'test' }, user_access_token: 'legacy-test-user' };
    const blocked = await search(config);
    assert.deepEqual(blocked.tokens, []);
    assert.equal(blocked.result.queries[0].reason, 'VK_SEARCH_CHANNEL_CONFIG_INVALID');
    assert.throws(() => prepareChannelConfigForStorage('vk', config), /VK_SEARCH_CHANNEL_CONFIG_INVALID/);
});
test('explicit clear removes current and stale nested search keys while preserving other secrets', async () => {
    const stored = prepareChannelConfigForStorage('vk', { search_access_token: 'current-test-key',
        user_access_token: 'legacy-test-user', publish_access_token: 'publish-test-key',
        raw_account: { search_access_token: 'nested-test-key', stats_access_token: 'stats-test-key' } });
    const cleared = prepareChannelConfigForStorage('vk', mergeChannelConfig({ ...sanitizeChannelConfig('vk', stored), search_access_token: '' }, stored));
    assert.equal(cleared.search_access_token_encrypted, undefined);
    assert.equal(cleared.raw_account.search_access_token_encrypted, undefined);
    assert.equal(cleared.raw_account.search_access_token, undefined);
    assert.equal(cleared.publish_access_token_encrypted, stored.publish_access_token_encrypted);
    assert.equal(cleared.raw_account.stats_access_token_encrypted, stored.raw_account.stats_access_token_encrypted);
    const effective = resolveEffectiveChannelConfig('vk', cleared);
    assert.equal(effective.search_access_token, undefined);
    assert.deepEqual((await search(effective)).tokens, ['legacy-test-user']);
    const standalone = prepareChannelConfigForStorage('vk', { search_access_token: '', search_access_token_encrypted: stored.search_access_token_encrypted,
        raw_account: { search_access_token: 'stale-plaintext-test' } });
    assert.equal(resolveEffectiveChannelConfig('vk', standalone).search_access_token, undefined);
});
test('unresolved explicit mask blocks legacy fallback and is not stored as a credential', async () => {
    const blocked = await search({ search_access_token: '******', user_access_token: 'legacy-test-user' });
    assert.deepEqual(blocked.tokens, []);
    assert.equal(blocked.result.queries[0].reason, 'VK_SEARCH_TOKEN_KIND_UNSUPPORTED');
    const stored = prepareChannelConfigForStorage('vk', mergeChannelConfig({ search_access_token: '******' }, {}));
    assert.equal(stored.search_access_token, undefined);
    assert.equal(stored.search_access_token_encrypted, undefined);
});
test('masked new search key cannot preserve an unvalidated ciphertext supplied by caller', () => {
    assert.throws(() => prepareChannelConfigForStorage('vk', mergeChannelConfig({
        search_access_token: '******', search_access_token_encrypted: 'enc:v1:invalid-test'
    }, {})), /VK_SEARCH_CHANNEL_CONFIG_INVALID/);
});
