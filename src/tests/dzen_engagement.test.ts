import test from 'node:test';
import assert from 'node:assert/strict';
import { isDzenPublishedUrl, parseDzenCompactNumber, scoreDzenSearchResult } from '../services/dzen.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { extractDzenStudioMetrics } from '../services/puppeteer_publisher.service';

test('Dzen compact counters are normalized', () => {
    assert.equal(parseDzenCompactNumber('1,2 тыс.'), 1200);
    assert.equal(parseDzenCompactNumber('3.4K просмотров'), 3400);
    assert.equal(parseDzenCompactNumber('2 млн'), 2_000_000);
    assert.equal(parseDzenCompactNumber('нет данных'), null);
});

test('Dzen search relevance rewards title matches', () => {
    const titleMatch = scoreDzenSearchResult('приемка результата агента', 'Приемка результата агента', 'Практический разбор');
    const snippetMatch = scoreDzenSearchResult('приемка результата агента', 'Рабочий процесс', 'Как устроена приемка результата агента');
    assert.ok(titleMatch.score > snippetMatch.score);
    assert.deepEqual(titleMatch.matched_terms.sort(), ['агента', 'приемка', 'результата'].sort());
});

test('Dzen engagement accepts only public publication URLs', () => {
    assert.equal(isDzenPublishedUrl('https://dzen.ru/a/example-id'), true);
    assert.equal(isDzenPublishedUrl('https://dzen.ru/profile/editor/id/secret'), false);
    assert.equal(isDzenPublishedUrl('https://example.com/a/example-id'), false);
});

test('Dzen studio counters are matched to the publication permalink', () => {
    const metrics = extractDzenStudioMetrics({
        publications: [{ id: 'publication-1', commonUrl: '/a/example-id' }],
        publicationCounters: [{ publicationId: 'publication-1', views: 2, impressions: 14, pageViews: 3, clicks: 1, deepViews: 1, shares: 1, subscriptions: 0, sumViewTimeSec: 42, ctr: 0.5 }],
        socialCounters: [{ publicationId: 'publication-1', likeCount: 4, commentCount: 5 }]
    }, 'https://dzen.ru/a/example-id');
    assert.deepEqual(metrics, {
        views: 2, likes: 4, comments: 5, impressions: 14, pageViews: 3, clicks: 1,
        deepViews: 1, shares: 1, subscriptions: 0, sumViewTimeSec: 42, ctr: 0.5
    });
});

test('planner can use Dzen engagement tools but strategist cannot publish comments', () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_dzen_collect_post_metrics'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_dzen_search_relevant_posts'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_dzen_comment'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_dzen_search_relevant_posts'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_dzen_comment'), false);
});
