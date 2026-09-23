"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = __importDefault(require("node:http"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const dzen_service_1 = require("../services/dzen.service");
const capabilities_1 = require("../mcp/capabilities");
const puppeteer_publisher_service_1 = require("../services/puppeteer_publisher.service");
(0, node_test_1.default)('Dzen compact counters are normalized', () => {
    strict_1.default.equal((0, dzen_service_1.parseDzenCompactNumber)('1,2 тыс.'), 1200);
    strict_1.default.equal((0, dzen_service_1.parseDzenCompactNumber)('3.4K просмотров'), 3400);
    strict_1.default.equal((0, dzen_service_1.parseDzenCompactNumber)('2 млн'), 2000000);
    strict_1.default.equal((0, dzen_service_1.parseDzenCompactNumber)('нет данных'), null);
});
(0, node_test_1.default)('Dzen search relevance rewards title matches', () => {
    const titleMatch = (0, dzen_service_1.scoreDzenSearchResult)('приемка результата агента', 'Приемка результата агента', 'Практический разбор');
    const snippetMatch = (0, dzen_service_1.scoreDzenSearchResult)('приемка результата агента', 'Рабочий процесс', 'Как устроена приемка результата агента');
    strict_1.default.ok(titleMatch.score > snippetMatch.score);
    strict_1.default.deepEqual(titleMatch.matched_terms.sort(), ['агента', 'приемка', 'результата'].sort());
});
(0, node_test_1.default)('Dzen engagement accepts only public publication URLs', () => {
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://dzen.ru/a/example-id'), true);
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://dzen.ru/profile/editor/id/secret'), false);
    strict_1.default.equal((0, dzen_service_1.isDzenPublishedUrl)('https://example.com/a/example-id'), false);
});
(0, node_test_1.default)('Dzen studio counters are matched to the publication permalink', () => {
    const metrics = (0, puppeteer_publisher_service_1.extractDzenStudioMetrics)({
        publications: [{ id: 'publication-1', commonUrl: '/a/example-id' }],
        publicationCounters: [{ publicationId: 'publication-1', views: 2, impressions: 14, pageViews: 3, clicks: 1, deepViews: 1, shares: 1, subscriptions: 0, sumViewTimeSec: 42, ctr: 0.5 }],
        socialCounters: [{ publicationId: 'publication-1', likeCount: 4, commentCount: 5 }]
    }, 'https://dzen.ru/a/example-id');
    strict_1.default.deepEqual(metrics, {
        views: 2, likes: 4, comments: 5, impressions: 14, pageViews: 3, clicks: 1,
        deepViews: 1, shares: 1, subscriptions: 0, sumViewTimeSec: 42, ctr: 0.5
    });
});
(0, node_test_1.default)('planner can use Dzen engagement tools but strategist cannot publish comments', () => {
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_dzen_collect_post_metrics'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_dzen_search_relevant_posts'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('planner', 'ba_dzen_comment'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', 'ba_dzen_search_relevant_posts'), true);
    strict_1.default.equal((0, capabilities_1.isToolAllowedForProfile)('strategist', 'ba_dzen_comment'), false);
});
(0, node_test_1.default)('Dzen comment composer supports semantic current and fallback markup', () => {
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentComposer)({ tag: 'div', role: 'textbox', contentEditable: 'true', dataTestId: 'comment-editor' }) >= 7);
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentComposer)({ tag: 'div', contentEditable: 'true', context: 'Discussion' }) >= 3);
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentComposer)({ tag: 'textarea', placeholder: 'Write a reply' }) >= 7);
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentComposer)({ tag: 'div', contentEditable: 'true', context: 'Комментарии к публикации' }) >= 7);
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentComposer)({ tag: 'input', type: 'search', placeholder: 'Поиск' }) < 0);
});
(0, node_test_1.default)('Dzen comment submit supports localized and test-id controls', () => {
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentSubmit)({ tag: 'button', text: 'Ответить' }) >= 7);
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentSubmit)({ tag: 'button', ariaLabel: 'Send' }) >= 7);
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentSubmit)({ tag: 'button', dataTestId: 'comment-submit', context: 'Comments' }) >= 7);
    strict_1.default.ok((0, puppeteer_publisher_service_1.scoreDzenCommentSubmit)({ tag: 'button', text: 'Отправить', disabled: true }) < 0);
});
(0, node_test_1.default)('Dzen interaction navigation does not wait for permanent background requests', async () => {
    const sockets = new Set();
    const server = node_http_1.default.createServer((request, response) => {
        if (request.url?.startsWith('/hold'))
            return;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><body><main>ready</main><script>for(let i=0;i<3;i++)fetch(`/hold?i=${i}`)</script></body>');
    });
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    strict_1.default.ok(address && typeof address !== 'string');
    const browser = await puppeteer_1.default.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const started = Date.now();
        await (0, puppeteer_publisher_service_1.navigateDzenInteractionPage)(page, `http://127.0.0.1:${address.port}`, 2000);
        strict_1.default.equal(await page.$eval('main', (node) => node.textContent), 'ready');
        strict_1.default.ok(Date.now() - started < 2000);
    }
    finally {
        await browser.close();
        for (const socket of sockets)
            socket.destroy();
        await new Promise((resolve) => server.close(() => resolve()));
    }
});
