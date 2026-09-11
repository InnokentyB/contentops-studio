import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import puppeteer from 'puppeteer';
import { isDzenPublishedUrl, parseDzenCompactNumber, scoreDzenSearchResult } from '../services/dzen.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { extractDzenStudioMetrics, navigateDzenInteractionPage, scoreDzenCommentComposer, scoreDzenCommentSubmit } from '../services/puppeteer_publisher.service';

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

test('Dzen comment composer supports semantic current and fallback markup', () => {
    assert.ok(scoreDzenCommentComposer({ tag: 'div', role: 'textbox', contentEditable: 'true', dataTestId: 'comment-editor' }) >= 7);
    assert.ok(scoreDzenCommentComposer({ tag: 'div', contentEditable: 'true', context: 'Discussion' }) >= 3);
    assert.ok(scoreDzenCommentComposer({ tag: 'textarea', placeholder: 'Write a reply' }) >= 7);
    assert.ok(scoreDzenCommentComposer({ tag: 'div', contentEditable: 'true', context: 'Комментарии к публикации' }) >= 7);
    assert.ok(scoreDzenCommentComposer({ tag: 'input', type: 'search', placeholder: 'Поиск' }) < 0);
});

test('Dzen comment submit supports localized and test-id controls', () => {
    assert.ok(scoreDzenCommentSubmit({ tag: 'button', text: 'Ответить' }) >= 7);
    assert.ok(scoreDzenCommentSubmit({ tag: 'button', ariaLabel: 'Send' }) >= 7);
    assert.ok(scoreDzenCommentSubmit({ tag: 'button', dataTestId: 'comment-submit', context: 'Comments' }) >= 7);
    assert.ok(scoreDzenCommentSubmit({ tag: 'button', text: 'Отправить', disabled: true }) < 0);
});

test('Dzen interaction navigation does not wait for permanent background requests', async () => {
    const sockets = new Set<any>();
    const server = http.createServer((request, response) => {
        if (request.url?.startsWith('/hold')) return;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><body><main>ready</main><script>for(let i=0;i<3;i++)fetch(`/hold?i=${i}`)</script></body>');
    });
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const started = Date.now();
        await navigateDzenInteractionPage(page, `http://127.0.0.1:${address.port}`, 2_000);
        assert.equal(await page.$eval('main', (node) => node.textContent), 'ready');
        assert.ok(Date.now() - started < 2_000);
    } finally {
        await browser.close();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
