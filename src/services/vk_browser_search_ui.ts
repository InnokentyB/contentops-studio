import type { Page } from 'playwright';
import type { VkBrowserSearchCard, VkBrowserSearchUi } from './vk_browser_search.service';

interface Options {
    scope: VkBrowserSearchUi['scope'];
    /** Tentative selectors are NOT verified by screenshots. Default denies live navigation. */
    surface_status?: VkBrowserSearchUi['surface_status'];
    navigateFixture?: (url: string) => Promise<void>;
}

/** Read-only tentative DOM driver. A fixture exercises extraction, never establishes live validity. */
export class PlaywrightVkBrowserSearchUi implements VkBrowserSearchUi {
    readonly scope: VkBrowserSearchUi['scope'];
    readonly surface_status: VkBrowserSearchUi['surface_status'];
    constructor(private readonly page: Page, private readonly options: Options) {
        this.scope = options.scope;
        this.surface_status = options.surface_status ?? 'unverified';
    }
    async navigateSearch(url: string): Promise<void> {
        if (this.surface_status === 'unverified') throw new Error('[VK_BROWSER_SEARCH_UI_UNVERIFIED]');
        const target = new URL(url);
        if (target.origin !== 'https://vk.com' || target.pathname !== '/search/statuses'
            || !target.searchParams.has('q') || [...target.searchParams.keys()].some((key) => key !== 'q')) {
            throw new Error('[VK_BROWSER_SEARCH_TARGET_INVALID]');
        }
        if (this.surface_status === 'fixture') {
            if (!this.options.navigateFixture) throw new Error('[VK_BROWSER_SEARCH_FIXTURE_REQUIRED]');
            return this.options.navigateFixture(url);
        }
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    private ensureReadBoundary(): void {
        if (this.surface_status === 'unverified') throw new Error('[VK_BROWSER_SEARCH_UI_UNVERIFIED]');
        if (this.surface_status === 'fixture' && this.page.url() !== 'about:blank') {
            throw new Error('[VK_BROWSER_SEARCH_FIXTURE_PAGE_REQUIRED]');
        }
    }
    async readCards(): Promise<VkBrowserSearchCard[]> {
        this.ensureReadBoundary();
        return this.page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="post"], [data-post-id]')).slice(0, 200).map((post) => {
            const text = post.querySelector<HTMLElement>('[data-testid="post_text"]');
            const author = post.querySelector<HTMLAnchorElement>('[data-testid="post_author"]');
            const time = post.querySelector<HTMLTimeElement>('time[datetime]');
            const expand = post.querySelector<HTMLElement>('[data-testid="showmoretext-after"]');
            const dateLink = post.querySelector<HTMLAnchorElement>('[data-testid="post_date"][href]');
            let linkedId = '';
            if (dateLink) {
                try {
                    const link = new URL(dateLink.href);
                    const source = link.protocol === 'https:' && ['vk.com', 'vk.ru'].includes(link.hostname)
                        && !link.port && !link.username && !link.password
                        ? link.searchParams.get('w') ?? link.pathname.slice(1) : '';
                    linkedId = /^wall(-?[1-9]\d*_[1-9]\d*)$/.exec(source)?.[1] ?? '';
                } catch { linkedId = ''; /* Invalid permalink remains unknown evidence. */ }
            }
            return { post_id: post.dataset.postId && linkedId && post.dataset.postId !== linkedId
                ? '' : post.dataset.postId ?? linkedId, text: text?.innerText ?? '', author: author?.innerText ?? '',
                author_url: author?.href ?? null, published_at: time?.getAttribute('datetime') ?? null,
                date_label: post.querySelector<HTMLElement>('[data-testid="post_date"]')?.innerText ?? '',
                truncated: Boolean(expand && expand.getClientRects().length) };
        }));
    }
    async expandPost(postId: string): Promise<boolean> {
        this.ensureReadBoundary();
        if (!/^-?[1-9]\d*_[1-9]\d*$/.test(postId)) return false;
        const button = this.page.locator(`[data-post-id="${postId}"] [data-testid="showmoretext-after"]`);
        if (await button.count() !== 1 || !await button.isVisible()) return false;
        await button.click({ timeout: 30_000 });
        return true;
    }
    async scrollOnce(): Promise<boolean> {
        this.ensureReadBoundary();
        const before = await this.page.locator('[data-post-id]').count();
        await this.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await this.page.waitForTimeout(250);
        return await this.page.locator('[data-post-id]').count() > before;
    }
}
