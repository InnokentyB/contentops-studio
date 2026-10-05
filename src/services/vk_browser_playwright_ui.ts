import type { Page } from 'playwright';
import type { VkBrowserUi } from './vk_browser_worker.service';

const COMPOSER_TRIGGER = /создать запись|новая запись|что у вас нового|create post|new post|what'?s new/i;

export class PlaywrightVkBrowserUi implements VkBrowserUi {
    constructor(private readonly page: Page) {}

    async navigate(url: string) {
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
        const field = this.editor();
        await field.waitFor({ state: 'visible', timeout: 15_000 });
        await field.click();
    }

    async setPostText(text: string) {
        const field = this.editor();
        await field.waitFor({ state: 'visible', timeout: 15_000 });
        await field.fill(text);
        const current = (await field.inputValue().catch(async () => field.textContent()))?.trim() || '';
        if (current !== text) {
            throw new Error('[VK_BROWSER_TEXT_MISMATCH] Composer did not retain the exact accepted text');
        }
    }

    async attachImage(imagePath: string) {
        const input = this.page.locator('input[type="file"][accept*="image"], input[type="file"]').first();
        await input.waitFor({ state: 'attached', timeout: 15_000 });
        await input.setInputFiles(imagePath);
    }

    async captureScreenshot(screenshotPath: string) {
        await this.page.screenshot({ path: screenshotPath, fullPage: false });
    }

    private editor() {
        return this.page.locator([
            '[data-testid="post_field"] [contenteditable="true"]',
            '[contenteditable="true"][role="textbox"]',
            'textarea[placeholder*="запис"]',
            'textarea[placeholder*="post"]'
        ].join(', ')).first();
    }
}
