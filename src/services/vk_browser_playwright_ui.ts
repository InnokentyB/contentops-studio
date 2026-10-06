import type { Locator, Page } from 'playwright';
import type { VkBrowserUi } from './vk_browser_worker.service';

const COMPOSER_TRIGGER = /создать запись|новая запись|что у вас нового|create post|new post|what'?s new/i;

export class PlaywrightVkBrowserUi implements VkBrowserUi {
    private communityUrl: string | null = null;
    private acceptedText: string | null = null;

    constructor(private readonly page: Page) {}

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
        const dialog = this.page.locator('[role="dialog"]').last();
        const publish = dialog.getByRole('button', {
            name: /^Опубликовать$|^Разместить$|^Publish$/i
        }).last();
        const finalActionVisible = await publish
            .waitFor({ state: 'visible', timeout: 30_000 })
            .then(() => true)
            .catch(() => false);
        if (finalActionVisible) await publish.click({ timeout: 15_000 });
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
}
