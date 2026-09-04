import test from 'node:test';
import assert from 'node:assert/strict';
import { isDzenPublishedUrl, parseDzenCompactNumber, scoreDzenSearchResult } from '../services/dzen.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

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

test('planner can use Dzen engagement tools but strategist cannot publish comments', () => {
    assert.equal(isToolAllowedForProfile('planner', 'ba_dzen_collect_post_metrics'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_dzen_search_relevant_posts'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_dzen_comment'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_dzen_search_relevant_posts'), true);
    assert.equal(isToolAllowedForProfile('strategist', 'ba_dzen_comment'), false);
});
