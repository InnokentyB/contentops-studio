import type { Locator, Page } from 'playwright';
import { UnverifiedVkClipUi, type VkClipUi } from './vk_browser_clip_ui';
import type { VkBrowserUi } from './vk_browser_worker.service';

const COMPOSER_TRIGGER = /создать запись|новая запись|что у вас нового|create post|new post|what'?s new/i;

export class PlaywrightVkBrowserUi implements VkBrowserUi {
    private communityUrl: string | null = null;
    private acceptedText: string | null = null;
    private acceptedTitle: string | null = null;

    readonly clip: VkClipUi;

    constructor(private readonly page: Page, clip: VkClipUi = new UnverifiedVkClipUi()) {
        this.clip = clip;
    }

    async navigate(url: string) {
        this.communityUrl = url;
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    }

    async loginRequired() {
        if (/\/login(?:\?|$)/i.test(this.page.url())) return true;
        const password = this.page.locator('input[type="password"], input[name="password"]').first();
        if (await password.isVisible().catch(() => false)) return true;
        const loginButton = this.page.getByRole('button', { name: /войти|sign in|log in/i }).first();
        return loginButton.isVisible().catch(() => false);
    }

    async openWallComposer() {
        const button = this.page.getByRole('button', { name: COMPOSER_TRIGGER }).first();
        if (await button.isVisible().catch(() => false)) {
            await button.click();
            return;
        }

        const createButton = this.page.locator('[data-testid="group_publish_create_button"]').first();
        const createReady = await createButton
            .waitFor({ state: 'visible', timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
        if (createReady) {
            await createButton.click();
            const postOption = this.page.locator('[data-testid="group_publish_post_menu_item"]').first();
            await postOption.click({ timeout: 15_000 });
        }

        const field = await this.editor();
        await field.waitFor({ state: 'visible', timeout: 15_000 });
        await field.click();
    }

    async openComposer(placement: 'wall_post' | 'article' | 'video' | 'story' | 'clip') {
        if (placement === 'clip') throw new Error('[VK_CLIP_PORT_REQUIRED] Use the governed Clip-specific submission port');
        if (placement === 'wall_post') return this.openWallComposer();
        const createButton = this.page.locator('[data-testid="group_publish_create_button"]').first();
        await createButton.waitFor({ state: 'visible', timeout: 15_000 });
        await createButton.click();
        const item = this.page.locator(`[data-testid="group_publish_${placement}_menu_item"]`).first();
        await item.waitFor({ state: 'visible', timeout: 15_000 });
        await item.click({ timeout: 15_000 });
        if (placement === 'article') {
            await this.articleTitle().waitFor({ state: 'visible', timeout: 15_000 });
        } else {
            await this.mediaInput(placement === 'video' ? 'video' : null)
                .waitFor({ state: 'attached', timeout: 15_000 });
        }
    }

    async setContent(content: { placement: 'wall_post' | 'article' | 'video' | 'story' | 'clip'; title: string; text: string }) {
        if (content.placement === 'clip') throw new Error('[VK_CLIP_PORT_REQUIRED] Use the governed Clip-specific submission port');
        this.acceptedText = content.text;
        this.acceptedTitle = content.title || null;
        if (content.placement === 'wall_post') return this.setPostText(content.text);
        if (content.placement === 'story') return;
        const title = content.placement === 'article' ? this.articleTitle() : this.videoTitle();
        await title.waitFor({ state: 'visible', timeout: 15_000 });
        await title.fill(content.title);
        const titleValue = (await title.inputValue().catch(async () => title.innerText())).trim();
        if (titleValue !== content.title) throw new Error('[VK_BROWSER_TITLE_MISMATCH] Editor did not retain the exact accepted title');
        const body = content.placement === 'article' ? this.articleBody() : this.videoDescription();
        await body.waitFor({ state: 'visible', timeout: 15_000 });
        await body.fill(content.text);
        const bodyValue = (await body.inputValue().catch(async () => body.innerText())).trim();
        if (bodyValue !== content.text) throw new Error('[VK_BROWSER_TEXT_MISMATCH] Editor did not retain the exact accepted text');
    }

    async attachMedia(mediaPath: string, kind: 'image' | 'video') {
        const input = this.mediaInput(kind);
        await input.waitFor({ state: 'attached', timeout: 15_000 });
        await input.setInputFiles(mediaPath);
        const outcome = await this.page.waitForFunction(() => {
            if (/Не удалось загрузить|failed to upload/i.test(document.body.innerText)) return 'error';
            const progress = document.querySelector('[role="progressbar"], [data-testid*="upload_progress"]');
            return progress ? '' : 'ready';
        }, undefined, { timeout: 60_000 });
        if (await outcome.jsonValue() === 'error') {
            throw new Error('[VK_BROWSER_ASSET_UPLOAD_FAILED] VK rejected the approved media');
        }
    }

    async submit(placement: 'wall_post' | 'article' | 'video' | 'story' | 'clip') {
        if (placement === 'clip') throw new Error('[VK_CLIP_PORT_REQUIRED] Use the governed Clip-specific submission port');
        if (placement === 'wall_post') return this.submitPost();
        const candidates = placement === 'article'
            ? '[data-testid="article_publish_button"], [data-testid="posting_submit_button"]'
            : placement === 'video'
                ? '[data-testid="video_upload_submit_button"], [data-testid="posting_submit_button"]'
                : '[data-testid="story_publish_button"], [data-testid="posting_submit_button"]';
        const current = this.page.locator(candidates).last();
        if (await current.isVisible().catch(() => false)) {
            await current.click({ timeout: 15_000 });
            return;
        }
        const publish = this.page.getByRole('button', {
            name: /^Опубликовать$|^Разместить$|^Publish$/i
        }).last();
        await publish.waitFor({ state: 'visible', timeout: 15_000 });
        await publish.click({ timeout: 15_000 });
    }

    async readback(placement: 'wall_post' | 'article' | 'video' | 'story' | 'clip') {
        if (placement === 'clip') throw new Error('[VK_CLIP_PORT_REQUIRED] Use the governed Clip-specific submission port');
        if (placement === 'wall_post') return this.readbackPost();
        if (!this.communityUrl) return null;
        await this.page.goto(this.communityUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await this.page.waitForTimeout(1_000);
        const ownerMatch = /\/club(\d+)/.exec(new URL(this.communityUrl).pathname);
        const ownerId = ownerMatch ? `-${ownerMatch[1]}` : null;
        if (!ownerId) return null;
        if (placement === 'video') {
            const links = this.page.locator(`a[href*="/video${ownerId}_"]`);
            for (let index = 0; index < Math.min(await links.count(), 30); index += 1) {
                const link = links.nth(index);
                const title = ((await link.getAttribute('aria-label')) || (await link.innerText().catch(() => ''))).trim();
                if (this.acceptedTitle && !title.includes(this.acceptedTitle)) continue;
                const href = await link.getAttribute('href');
                const match = href?.match(new RegExp(`video${ownerId.replace('-', '\\-')}_(\\d+)`));
                if (!match) continue;
                const publicUrl = `https://vk.com/video${ownerId}_${match[1]}`;
                await this.page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
                const providerTitle = (await this.page.locator([
                    '[data-testid="video_title"]',
                    'h1',
                    '[class*="VideoTitle"]'
                ].join(', ')).first().innerText().catch(() => '')).trim();
                const providerText = (await this.page.locator([
                    '[data-testid="video_description"]',
                    '[class*="VideoDescription"]'
                ].join(', ')).first().innerText().catch(() => '')).trim();
                return {
                    public_url: publicUrl,
                    provider_object_id: `video${ownerId}_${match[1]}`,
                    owner_id: ownerId,
                    published_at: new Date().toISOString(),
                    title: providerTitle,
                    text: providerText,
                    media_present: await this.page.locator('video, [data-testid="video_player"]').first().isVisible().catch(() => false)
                };
            }
            return null;
        }
        if (placement === 'article') {
            const links = this.page.locator('a[href^="/@"], a[href*="/@"]');
            for (let index = 0; index < Math.min(await links.count(), 30); index += 1) {
                const link = links.nth(index);
                const title = (await link.innerText().catch(() => '')).trim();
                if (this.acceptedTitle && !title.includes(this.acceptedTitle)) continue;
                const href = await link.getAttribute('href');
                if (!href) continue;
                const id = await link.getAttribute('data-article-id');
                if (!id || !/^\d+$/.test(id)) continue;
                const publicUrl = new URL(href, 'https://vk.com').toString();
                await this.page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
                const providerTitle = (await this.page.locator([
                    '[data-testid="article_view_title"]',
                    'article h1',
                    'h1'
                ].join(', ')).first().innerText().catch(() => '')).trim();
                const providerText = (await this.page.locator([
                    '[data-testid="article_view_content"]',
                    '[class*="ArticleView__content"]',
                    '[class*="ArticlePage__content"]'
                ].join(', ')).first().innerText().catch(() => '')).trim();
                return {
                    public_url: publicUrl,
                    provider_object_id: `article${ownerId}_${id}`,
                    owner_id: ownerId,
                    published_at: new Date().toISOString(),
                    title: providerTitle,
                    text: providerText,
                    media_present: await this.page.locator('article img:visible').count() > 0
                };
            }
            return null;
        }
        const story = this.page.locator('[data-story-id], [data-testid="story_item"][data-id]').first();
        if (!await story.isVisible().catch(() => false)) return null;
        const id = await story.getAttribute('data-story-id') || await story.getAttribute('data-id');
        if (!id || !/^\d+$/.test(id)) return null;
        return {
            public_url: null,
            provider_object_id: `story${ownerId}_${id}`,
            owner_id: ownerId,
            published_at: new Date().toISOString(),
            title: null,
            text: '',
            media_present: true
        };
    }

    async setPostText(text: string) {
        const field = await this.editor();
        await field.waitFor({ state: 'visible', timeout: 15_000 });
        await field.fill(text);
        const current = (await field.inputValue().catch(async () => field.innerText()))?.trim() || '';
        if (current !== text) {
            throw new Error('[VK_BROWSER_TEXT_MISMATCH] Composer did not retain the exact accepted text');
        }
        this.acceptedText = text;
    }

    async attachImage(imagePath: string) {
        const currentInput = this.page
            .locator('input[data-testid="posting_base_screen_download_from_device"]')
            .first();
        const currentReady = await currentInput
            .waitFor({ state: 'attached', timeout: 5_000 })
            .then(() => true)
            .catch(() => false);
        const input = currentReady ? currentInput : this.page.locator([
            'input[type="file"][accept*="image"]',
            'input[type="file"]'
        ].join(', ')).first();
        await input.waitFor({ state: 'attached', timeout: 15_000 });
        await input.setInputFiles(imagePath);
        const outcomeHandle = await this.page.waitForFunction(() => {
            if (/Не удалось загрузить изображение|failed to upload image/i.test(document.body.innerText)) {
                return 'error';
            }
            const ready = Array.from(document.querySelectorAll<HTMLImageElement>('[role="dialog"] img'))
                .some((image) => Boolean(image.offsetWidth || image.offsetHeight)
                    && image.complete
                    && image.naturalWidth > 0);
            return ready ? 'ready' : '';
        }, undefined, { timeout: 15_000 });
        if (await outcomeHandle.jsonValue() === 'error') {
            throw new Error('[VK_BROWSER_ASSET_UPLOAD_FAILED] VK rejected the approved image');
        }
    }

    async captureScreenshot(screenshotPath: string) {
        await this.page.screenshot({ path: screenshotPath, fullPage: false });
    }

    async submitPost() {
        const next = this.page.getByRole('button', { name: /^Далее$|^Next$/i }).last();
        await next.click({ timeout: 15_000 });
        const currentPublish = this.page.locator('[data-testid="posting_submit_button"]').last();
        const currentReady = await currentPublish
            .waitFor({ state: 'visible', timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
        const publish = currentReady
            ? currentPublish
            : this.page.getByRole('button', {
                name: /^Опубликовать$|^Разместить$|^Publish$/i
            }).last();
        await publish.waitFor({ state: 'visible', timeout: 15_000 });
        await publish.click({ timeout: 15_000 });
    }

    async readbackPost() {
        if (!this.communityUrl || !this.acceptedText) return null;
        await this.page.goto(this.communityUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await this.page.waitForTimeout(1_000);
            const posts = this.page.locator('[data-testid="post"][data-post-id]');
            if (await posts.count() > 0) {
                const matches = [];
                for (let index = 0; index < Math.min(await posts.count(), 25); index += 1) {
                    const post = posts.nth(index);
                    const showMore = post.locator('[data-testid="showmoretext-after"]').first();
                    if (await showMore.isVisible().catch(() => false)) {
                        await showMore.click().catch(() => undefined);
                    }
                    const text = ((await post.locator('[data-testid="post_text"]').innerText().catch(() => '')) || '').trim();
                    if (text !== this.acceptedText.trim()) continue;
                    const providerObjectId = await post.getAttribute('data-post-id');
                    if (!providerObjectId || !/^-\d+_\d+$/.test(providerObjectId)) continue;
                    const imagePresent = await post.locator('[data-testid="post-content-container"] img:visible').count() > 0;
                    matches.push({ providerObjectId, text, imagePresent });
                }
                if (matches.length === 1) {
                    const match = matches[0];
                    return {
                        public_url: `https://vk.com/wall${match.providerObjectId}`,
                        provider_object_id: match.providerObjectId,
                        published_at: new Date().toISOString(),
                        text: match.text,
                        image_present: match.imagePresent
                    };
                }
                if (matches.length > 1) return null;
            }
            await this.page.evaluate((scrollAttempt) => {
                window.scrollTo(0, Math.min(document.documentElement.scrollHeight, 4_000 + scrollAttempt * 2_000));
            }, attempt);
        }
        return null;
    }

    private async editor(): Promise<Locator> {
        const selectors = [
            '[data-testid="posting_base_screen_input_message"]',
            '[data-testid="post_field"] [contenteditable="true"]',
            '[contenteditable="true"][role="textbox"]',
            'textarea[placeholder*="запис"]',
            'textarea[placeholder*="post"]'
        ];
        for (const selector of selectors) {
            const candidate = this.page.locator(selector).first();
            if (await candidate.isVisible().catch(() => false)) return candidate;
        }
        return this.page.locator(selectors[0]).first();
    }

    private articleTitle() {
        return this.page.locator([
            '[data-testid="article_editor_title"]',
            'textarea[placeholder*="заголов"]',
            'input[placeholder*="заголов"]',
            'textarea[placeholder*="title"]',
            'input[placeholder*="title"]'
        ].join(', ')).first();
    }

    private articleBody() {
        return this.page.locator([
            '[data-testid="article_editor_body"] [contenteditable="true"]',
            '[contenteditable="true"][data-placeholder*="текст"]',
            '[contenteditable="true"][data-placeholder*="text"]'
        ].join(', ')).first();
    }

    private videoTitle() {
        return this.page.locator([
            '[data-testid="video_upload_title"]',
            'input[name="title"]',
            'input[placeholder*="назван"]',
            'input[placeholder*="title"]'
        ].join(', ')).first();
    }

    private videoDescription() {
        return this.page.locator([
            '[data-testid="video_upload_description"]',
            'textarea[name="description"]',
            'textarea[placeholder*="описан"]',
            'textarea[placeholder*="description"]'
        ].join(', ')).first();
    }

    private mediaInput(kind: 'image' | 'video' | null) {
        const accept = kind === 'video' ? 'video' : kind === 'image' ? 'image' : '';
        return this.page.locator([
            accept ? `input[type="file"][accept*="${accept}"]` : '',
            '[data-testid*="upload"] input[type="file"]',
            'input[type="file"]'
        ].filter(Boolean).join(', ')).first();
    }
}
