import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../db';
import engagement from '../services/dzen_engagement.service';
import dzen from '../services/dzen.service';
import { screenDzenCard, dzenReadFailure } from '../services/dzen_radar';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMediaMetricsTools } from '../mcp/tools/media_metrics_tools';
import { z } from 'zod';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';

test('card screening never infers publication freshness from snippet or capture time', () => {
    const card = screenDzenCard({ url: 'https://dzen.ru/a/test', title: 'Лучшие агенты 2026', snippet: 'Сегодня скидка, купить курс. Подпишитесь!', score: 100, matched_terms: ['агенты'] }, '2026-10-08T12:00:00Z');
    assert.equal(card.screening.freshness.status, 'unknown');
    assert.equal(card.screening.freshness.published_at, null);
    assert.equal(card.screening.quality.disposition, 'review_required');
    assert.ok(card.screening.quality.flags.includes('promotional_language'));
    assert.ok(card.screening.quality.flags.includes('seo_listicle_language'));
    assert.equal(card.provenance.source, 'dzen_search_card');
    assert.equal(card.provenance.article_body_read, false);
});

test('absence of heuristic flags is not an acceptance verdict', () => {
    const card = screenDzenCard({ url: 'https://dzen.ru/a/test', title: 'Приемка агента', snippet: 'Разбор собственного эксперимента с наблюдениями и результатами проверки', score: 100, matched_terms: ['агента'] }, '2026-10-08T12:00:00Z');
    assert.equal(card.screening.quality.disposition, 'review_required');
    assert.deepEqual(card.screening.quality.flags, []);
});

test('search provenance strips provider tracking and rejects credential-bearing or foreign links', () => {
    const card = { url: 'https://dzen.ru/a/test?secdata=private-tracking&token=private-value#fragment',
        title: 'Приемка агента', snippet: 'Наблюдения', score: 75, matched_terms: ['агента'] };
    const screened = screenDzenCard(card, '2026-10-08T16:00:00Z');
    assert.equal(screened.url, 'https://dzen.ru/a/test');
    assert.equal(screened.provenance.evidence_ref, screened.url);
    assert.doesNotMatch(JSON.stringify(screened), /private-|secdata|token|fragment/);
    for (const url of ['https://example.com/a/test', 'https://user:password@dzen.ru/a/test', 'file://dzen.ru/a/test', 'https://dzen.ru/studio/test']) {
        assert.throws(() => screenDzenCard({ ...card, url }, '2026-10-08T16:00:00Z'), /DZEN_SEARCH_RESULT_URL_INVALID/);
    }
});

test('read failures classify gaps without leaking provider error payloads', () => {
    assert.equal(dzenReadFailure(new Error('DZEN_SEARCH_INTERFACE_CHANGED')).code, 'interface_changed');
    assert.equal(dzenReadFailure(new Error('DZEN_AUTH_REQUIRED')).code, 'auth_required');
    assert.equal(dzenReadFailure(new Error('DZEN_SEARCH_RESULT_URL_INVALID')).code, 'invalid_result');
    assert.equal(dzenReadFailure(new Error('Dzen authentication failed: the saved session is invalid or expired')).code, 'auth_required');
    assert.equal(dzenReadFailure(new Error('Dzen requires a CAPTCHA or interactive account verification')).code, 'interactive_verification_required');
    assert.equal(dzenReadFailure(new Error('Navigation timeout of 30000 ms exceeded')).code, 'timeout');
    assert.equal(dzenReadFailure(new Error('DZEN_BROWSER_SESSION_BUSY')).code, 'session_busy');
    assert.doesNotMatch(JSON.stringify(dzenReadFailure(new Error('cookie=SECRET https://provider/?token=SECRET'))), /SECRET|cookie|token/);
});

test('read-only radar diagnostic is available only to intended profiles', () => {
    for (const role of ['planner', 'strategist', 'owner'] as const) assert.equal(isToolAllowedForProfile(role, 'ba_dzen_get_radar_coverage'), true);
    for (const role of ['writer', 'publisher', 'organization_researcher'] as const) assert.equal(isToolAllowedForProfile(role, 'ba_dzen_get_radar_coverage'), false);
});

test('remote radar diagnostic cannot override token-bound project or actor', () => {
    const principal = { userId: 2, actorId: 'user:2', projectId: 10, profile: 'planner' as const };
    const request = { method: 'tools/call', params: { name: 'ba_dzen_get_radar_coverage',
        arguments: { projectId: 10, actorId: 'user:999', channelId: 116 } } };
    const scoped = scopeRemoteMcpRequest(request, principal);
    assert.equal(scoped.allowed, true);
    assert.equal(scoped.body.params.arguments.actorId, 'user:2');
    assert.equal(scopeRemoteMcpRequest({ ...request, params: { ...request.params,
        arguments: { ...request.params.arguments, projectId: 11 } } }, principal).allowed, false);
});

test('MCP registers the diagnostic with a validated scope and read-only annotations', t => {
    const server = new McpServer({ name: 'radar-test', version: '1' });
    const register = t.mock.method(server, 'registerTool');
    registerMediaMetricsTools(server);
    const call = register.mock.calls.find(entry => entry.arguments[0] === 'ba_dzen_get_radar_coverage');
    assert.ok(call);
    const config = call.arguments[1];
    assert.ok(config && typeof config === 'object');
    assert.deepEqual(Reflect.get(config, 'annotations'), { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const schema: unknown = Reflect.get(config, 'inputSchema');
    assert.ok(schema && typeof schema === 'object');
    for (const [field, invalid] of [['projectId', -1], ['channelId', 0], ['actorId', '']] as const) {
        const validator: unknown = Reflect.get(schema, field);
        assert.ok(validator instanceof z.ZodType);
        assert.equal(validator.safeParse(invalid).success, false);
    }
});

test('local diagnostic retains UNKNOWN/null until native surfaces are scanned; search failure cannot become zero', async t => {
    let member = true;
    let channel = true;
    let lookups = 0;
    const replace = (target: object, key: string, value: (...args: unknown[]) => Promise<unknown>) => {
        const original = Reflect.get(target, key);
        Object.defineProperty(target, key, { value, configurable: true, writable: true });
        t.after(() => Object.defineProperty(target, key, { value: original, configurable: true, writable: true }));
    };
    replace(prisma.projectMember, 'findUnique', async () => member ? { id: 1 } : null);
    replace(prisma.socialChannel, 'findFirst', async (...args) => {
        lookups++;
        assert.deepEqual(args[0], { where: { id: 116, project_id: 10, is_active: true }, select: { type: true, config: true } });
        return channel ? { type: 'dzen', config: { cookies: 'test-only=SECRET', channel_id: 'provider' } } : null;
    });
    const args = { projectId: 10, channelId: 116, actorId: 'user:1' };
    const result = await engagement.getRadarCoverage(args);
    assert.equal(result.complete, false);
    assert.equal(result.provenance.provider_requested, false);
    for (const surface of ['owned_channel', 'comments', 'replies', 'activity'] as const) {
        assert.equal(result.surfaces[surface].status, 'unknown');
        assert.equal(result.surfaces[surface].count, null);
        assert.equal(result.surfaces[surface].reason.code, 'not_scanned');
        assert.match(result.surfaces[surface].reason.next_step, /ba_dzen_read_inbound/);
        assert.ok(result.surfaces[surface].reason.evidence.length > 0);
    }
    assert.doesNotMatch(JSON.stringify(result), /SECRET|provider"/);
    t.mock.method(dzen, 'searchRelevantPosts', async () => { throw new Error('DZEN_SEARCH_INTERFACE_CHANGED: SECRET'); });
    const failed = await engagement.searchRelevantPosts({ ...args, query: 'агенты' });
    assert.equal(failed.count, null);
    assert.equal(failed.status, 'unknown');
    assert.equal(failed.error?.code, 'interface_changed');
    assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
    member = false;
    const before = lookups;
    await assert.rejects(engagement.getRadarCoverage(args), /Access denied/);
    assert.equal(lookups, before);
    member = true;
    channel = false;
    await assert.rejects(engagement.getRadarCoverage(args), /ACTIVE_DZEN_CHANNEL_NOT_FOUND/);
});

test('successful discovery preserves results and distinguishes returned count from total activity', async t => {
    const replace = (target: object, key: string, value: () => Promise<unknown>) => {
        const original = Reflect.get(target, key);
        Object.defineProperty(target, key, { value, configurable: true, writable: true });
        t.after(() => Object.defineProperty(target, key, { value: original, configurable: true, writable: true }));
    };
    replace(prisma.projectMember, 'findUnique', async () => ({ id: 1 }));
    replace(prisma.socialChannel, 'findFirst', async () => ({ type: 'dzen', config: {} }));
    t.mock.method(dzen, 'searchRelevantPosts', async () => [{ url: 'https://dzen.ru/a/test', title: 'Купить курс', snippet: 'Скидка', score: 75, matched_terms: ['курс'] }]);
    const result = await engagement.searchRelevantPosts({ projectId: 10, channelId: 116, actorId: 'user:1', query: 'курс' });
    assert.equal(result.count, 1);
    assert.equal(result.status, 'observed');
    assert.equal(result.posts[0].screening.freshness.status, 'unknown');
    assert.equal(result.coverage.surfaces.replies.count, null);
    assert.equal(result.coverage.surfaces.public_discovery.status, 'observed');
    assert.equal(result.coverage.complete, false);
    assert.equal(result.provenance.count_scope, 'returned_relevance_filtered_cards');
});
