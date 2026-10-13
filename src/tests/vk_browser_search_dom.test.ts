import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { PlaywrightVkBrowserSearchUi } from '../services/vk_browser_search_ui';
import { runVkBrowserSearch } from '../services/vk_browser_search.service';

const job = { schema_version: 1, action: 'browser_search', job_id: 'offline-dom-search', project_id: 10, channel_id: 135,
    queries: ['бизнес анализ'], since: '2026-10-01T00:00:00Z', until: '2026-10-12T23:59:59Z',
    topic_concepts: [['бизнес'], ['анализ']], max_scroll_rounds: 2 };

test('SEARCH-DOM-001 offline HTML expands text, preserves author/date and canonicalizes wall overlay identity', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const context = await browser.newContext();
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        const html = `<article data-post-id="-201481058_17893">
            <a data-testid="post_author" href="https://vk.com/club201481058">Публичный автор</a>
            <a data-testid="post_date" href="https://vk.com/search/statuses?q=x&w=wall-201481058_17893"><time datetime="2026-10-10T10:00:00Z">10 октября</time></a>
            <div data-testid="post_text">Бизнес…</div>
            <button data-testid="showmoretext-after" onclick="this.previousElementSibling.textContent='Бизнес анализ и требования. Полный текст.';this.remove()">Показать полностью</button>
        </article>
        <article data-testid="post"><a data-testid="post_author" href="https://vk.com/club1">Другой автор</a>
        <a data-testid="post_date" href="https://vk.com/search/statuses?q=x&w=wall-1_2"><time datetime="2026-10-10T11:00:00Z">10 октября</time></a>
        <div data-testid="post_text">Бизнес анализ второго автора</div></article>
        <article data-testid="post"><a data-testid="post_date" href="https://evil.example/wall-1_3">10 октября</a>
        <div data-testid="post_text">Бизнес анализ</div></article>`;
        const ui = new PlaywrightVkBrowserSearchUi(page, { surface_status: 'fixture',
            scope: { project_id: 10, channel_id: 135, permission: 'search_only' },
            navigateFixture: async () => { await page.setContent(html); } });
        const result = await runVkBrowserSearch(job, ui);
        assert.equal(page.url(), 'about:blank');
        assert.equal(result.posts.length, 2);
        assert.equal(result.posts[1].public_url, 'https://vk.com/wall-1_2');
        assert.equal(result.coverage.invalid_cards, 1);
        assert.equal(result.posts[0].original_text, 'Бизнес анализ и требования. Полный текст.');
        assert.equal(result.posts[0].author, 'Публичный автор');
        assert.equal(result.posts[0].public_url, 'https://vk.com/wall-201481058_17893');
        assert.equal(result.posts[0].observed_publication_time, '2026-10-10T10:00:00.000Z');
        assert.equal(result.coverage.live_verified, false);
    } finally { await browser.close(); }
});
