import puppeteer, { type Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';

interface HabrPublishConfig {
    cookies: string;
    hub_ids?: string[];
}

interface DzenPublishConfig {
    cookies: string;
    channel_id?: string;
    channel_url?: string;
    article_editor_url?: string;
    post_editor_url?: string;
}

type DzenPublicationType = 'article' | 'post';

export const DZEN_EDITOR_SELECTORS = {
    addPublication: '[data-testid="add-publication-button"]',
    articleMenuItem: '[role="button"][aria-label="Написать статью"]',
    postMenuItem: '[role="button"][aria-label="Написать пост"]',
    articleTitle: '[contenteditable="true"][role="textbox"]:has(h1[data-block="true"])',
    articleBody: '[contenteditable="true"][role="textbox"]:has(.zen-editor-block)',
    articlePublish: '[data-testid="article-publish-btn"]'
} as const;

export async function typeDzenContentEditableText(element: any, text: string): Promise<void> {
    await element.focus();
    await element.type(text, { delay: 1 });
}

class PuppeteerPublisherService {
    private dzenChannelId(config: DzenPublishConfig): string | null {
        const candidate = config.channel_id?.trim() || config.channel_url?.trim() || '';
        if (!candidate) return null;
        const directId = candidate.match(/^[a-zA-Z0-9_-]+$/)?.[0];
        if (directId) return directId;
        try {
            const url = new URL(candidate);
            if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname)) return null;
            return url.pathname.match(/\/(?:id|profile\/editor\/id)\/([^/?#]+)/)?.[1] || null;
        } catch {
            return null;
        }
    }

    private dzenChannelEditorUrl(config: DzenPublishConfig): string {
        const channelId = this.dzenChannelId(config);
        return channelId
            ? `https://dzen.ru/profile/editor/id/${encodeURIComponent(channelId)}`
            : (config.article_editor_url || 'https://dzen.ru/studio/editor/create/article');
    }

    private async openDzenComposer(page: Page, config: DzenPublishConfig, publicationType: DzenPublicationType) {
        const channelId = this.dzenChannelId(config);
        if (!channelId) {
            const configuredUrl = publicationType === 'article'
                ? config.article_editor_url
                : config.post_editor_url;
            if (!configuredUrl) {
                throw new Error('Dzen channel ID is required to open the current publication editor');
            }
            await page.goto(configuredUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
            return;
        }

        const publicationsUrl = `https://dzen.ru/profile/editor/id/${encodeURIComponent(channelId)}/publications`;
        await page.goto(publicationsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
        await this.assertDzenAuthenticated(page);
        await page.waitForSelector(DZEN_EDITOR_SELECTORS.addPublication, { timeout: 15_000 });
        await page.click(DZEN_EDITOR_SELECTORS.addPublication);

        const menuSelector = publicationType === 'article'
            ? DZEN_EDITOR_SELECTORS.articleMenuItem
            : DZEN_EDITOR_SELECTORS.postMenuItem;
        await page.waitForSelector(menuSelector, { timeout: 10_000 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => undefined),
            page.click(menuSelector)
        ]);
        await page.waitForFunction(
            () => /\/profile\/editor\/id\/[^/]+\/[^/]+\/edit(?:[/?#]|$)/.test(window.location.href),
            { timeout: 15_000 }
        );
    }

    /**
     * Parse raw browser Cookie header string into Puppeteer-compliant cookies.
     */
    private parseCookieString(cookieStr: string, domain: string): any[] {
        return cookieStr
            .split(';')
            .map((item) => {
                const trimmed = item.trim();
                const index = trimmed.indexOf('=');
                if (index === -1) return null;
                const name = trimmed.substring(0, index);
                const value = trimmed.substring(index + 1);
                return {
                    name,
                    value,
                    domain,
                    path: '/'
                };
            })
            .filter((c): c is { name: string; value: string; domain: string; path: string } => 
                c !== null && c.name !== '' && c.value !== ''
            );
    }

    /**
     * Launch a standard Puppeteer browser instance.
     */
    private async launchBrowser() {
        return await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
    }

    /**
     * Save diagnostic screenshot of the page for troubleshooting.
     */
    private async saveErrorScreenshot(page: Page, platform: string): Promise<string> {
        try {
            const timestamp = Date.now();
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const filename = `puppeteer-error-${platform}-${timestamp}.png`;
            const screenshotPath = path.join(logsDir, filename);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.error(`[PuppeteerPublisher] Diagnostic screenshot saved to ${screenshotPath}`);
            return filename;
        } catch (e: any) {
            console.error('[PuppeteerPublisher] Failed to take diagnostic screenshot:', e.message);
            return 'screenshot-failed';
        }
    }

    private async assertDzenAuthenticated(page: Page) {
        const currentUrl = page.url();
        const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
        if (
            currentUrl.includes('/login')
            || currentUrl.includes('passport.yandex.ru')
            || /войти|авторизуйтесь|sign in/i.test(pageText.slice(0, 1200))
        ) {
            throw new Error('Dzen authentication failed: the saved session is invalid or expired');
        }
        if (/captcha|подтвердите, что вы не робот|робот/i.test(`${currentUrl}\n${pageText}`)) {
            throw new Error('Dzen requires a CAPTCHA or interactive account verification');
        }
    }

    private isPublicDzenUrl(value: string) {
        try {
            const url = new URL(value);
            return ['dzen.ru', 'www.dzen.ru'].includes(url.hostname)
                && !url.pathname.startsWith('/studio')
                && !url.pathname.includes('/editor/')
                && !/\bmock[-_/]/i.test(url.pathname)
                && (/\/(?:a|b)\//.test(url.pathname) || /\/media\/id\//.test(url.pathname));
        } catch {
            return false;
        }
    }

    private async uploadDzenImage(page: Page, imageUrl: string) {
        const url = new URL(imageUrl);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new Error('Dzen image URL must be an authenticated-free HTTPS URL');
        }
        if (['localhost', 'metadata.google.internal'].includes(url.hostname.toLowerCase())) {
            throw new Error('Dzen image URL points to a forbidden host');
        }
        const addresses = await dns.lookup(url.hostname, { all: true });
        if (addresses.length === 0 || addresses.some(({ address }) => this.isPrivateNetworkAddress(address))) {
            throw new Error('Dzen image URL resolves to a private or unavailable network address');
        }

        const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
        if (!response.ok) {
            throw new Error(`Unable to download the Dzen image (${response.status})`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            throw new Error(`Dzen image URL returned unsupported content type: ${contentType || 'unknown'}`);
        }
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > 15 * 1024 * 1024) {
            throw new Error('Dzen image is larger than 15 MB');
        }
        if (!response.body) throw new Error('Dzen image response body is empty');
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of response.body as any) {
            const buffer = Buffer.from(chunk);
            totalBytes += buffer.length;
            if (totalBytes > 15 * 1024 * 1024) {
                throw new Error('Dzen image is larger than 15 MB');
            }
            chunks.push(buffer);
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length === 0) {
            throw new Error('Dzen image must be between 1 byte and 15 MB');
        }

        const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
        const tempPath = path.join(process.cwd(), 'logs', `dzen-upload-${Date.now()}.${extension}`);
        fs.mkdirSync(path.dirname(tempPath), { recursive: true });
        fs.writeFileSync(tempPath, bytes);
        try {
            let input = await page.$('input[type="file"][accept*="image"], input[type="file"]');
            if (!input) {
                await page.evaluate(() => {
                    const controls = Array.from(document.querySelectorAll('button, [role="button"]'));
                    const imageControl = controls.find((element) => {
                        const label = `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`;
                        return /изображ|картин|фото|image|photo/i.test(label);
                    });
                    (imageControl as HTMLElement | undefined)?.click();
                });
                input = await page.waitForSelector('input[type="file"][accept*="image"], input[type="file"]', { timeout: 10_000 });
            }
            if (!input) throw new Error('Dzen image upload control was not found');
            await input.uploadFile(tempPath);
            await page.waitForFunction(
                () => Boolean(document.querySelector('img[src^="blob:"], img[src*="avatars"], img[src*="dzeninfra"]')),
                { timeout: 20_000 }
            ).catch(() => undefined);
        } finally {
            fs.rmSync(tempPath, { force: true });
        }
    }

    private isPrivateNetworkAddress(address: string) {
        if (net.isIPv4(address)) {
            const [a, b] = address.split('.').map(Number);
            return a === 10
                || a === 127
                || a === 0
                || (a === 169 && b === 254)
                || (a === 172 && b >= 16 && b <= 31)
                || (a === 192 && b === 168);
        }
        const normalized = address.toLowerCase();
        return normalized === '::1'
            || normalized === '::'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || normalized.startsWith('fe80:')
            || normalized.startsWith('::ffff:127.')
            || normalized.startsWith('::ffff:10.')
            || normalized.startsWith('::ffff:192.168.');
    }

    private async listPublicDzenUrls(page: Page): Promise<string[]> {
        return page.evaluate(() => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((link) => link.href));
    }

    private async findDzenPublishedUrl(page: Page, previousUrls: Set<string>): Promise<string | null> {
        const current = page.url();
        if (this.isPublicDzenUrl(current)) return current;

        const candidate = await page.evaluate((excluded) => {
            const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
            return links.map((link) => link.href).find((href) => {
                if (excluded.includes(href)) return false;
                try {
                    const url = new URL(href);
                    return ['dzen.ru', 'www.dzen.ru'].includes(url.hostname)
                        && !url.pathname.startsWith('/studio')
                        && !url.pathname.includes('/editor/')
                        && !/\bmock[-_/]/i.test(url.pathname)
                        && (/\/(?:a|b)\//.test(url.pathname) || /\/media\/id\//.test(url.pathname));
                } catch {
                    return false;
                }
            }) || null;
        }, Array.from(previousUrls));
        return candidate && this.isPublicDzenUrl(candidate) ? candidate : null;
    }

    /**
     * Publish an article to Habr.com using Puppeteer.
     */
    async publishToHabr(
        config: HabrPublishConfig,
        title: string,
        text: string,
        imageUrl?: string
    ): Promise<string> {
        console.log('[PuppeteerPublisher] Initializing Habr publication...');
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        
        // Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            // Apply cookies on both habr.com and .habr.com domains
            const cookiesMain = this.parseCookieString(config.cookies, 'habr.com');
            const cookiesDot = this.parseCookieString(config.cookies, '.habr.com');
            
            if (cookiesMain.length === 0) {
                throw new Error('Habr cookie string is empty or invalid');
            }

            await page.setCookie(...cookiesMain, ...cookiesDot);

            // Go to editor page
            const editorUrl = 'https://habr.com/ru/journal/add/';
            console.log(`[PuppeteerPublisher] Navigating to ${editorUrl}`);
            await page.goto(editorUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Check if authenticated
            const currentUrl = page.url();
            if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
                throw new Error('Habr authentication failed: Session cookies are invalid or expired.');
            }

            // Fill Title
            console.log('[PuppeteerPublisher] Filling title...');
            const titleSelector = 'input[placeholder="Заголовок"], textarea[placeholder="Заголовок"], [placeholder="Заголовок"], .tm-editor-title-textarea';
            const titleEl = await page.waitForSelector(titleSelector, { timeout: 15000 });
            if (!titleEl) throw new Error('Could not find Habr title input field');
            
            await titleEl.focus();
            await page.evaluate((el: any, t) => {
                el.value = t;
                const evt = document.createEvent('HTMLEvents');
                evt.initEvent('input', true, true);
                el.dispatchEvent(evt);
            }, titleEl, title);

            // Fill Content body
            console.log('[PuppeteerPublisher] Filling body content...');
            const bodySelector = '[contenteditable="true"], .editor__input, .ce-element';
            const bodyEl = await page.waitForSelector(bodySelector, { timeout: 15000 });
            if (!bodyEl) throw new Error('Could not find Habr content editable editor body');
            
            await bodyEl.focus();
            await page.evaluate((el: any, markdownText: string) => {
                el.focus();
                document.execCommand('selectAll', false, undefined);
                document.execCommand('insertText', false, markdownText);
            }, bodyEl, text);

            // Let editor parse and process content
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Optional: Upload cover image if provided
            if (imageUrl) {
                console.log(`[PuppeteerPublisher] Attach image url parameter: ${imageUrl}`);
                // Note: Real browser upload would require downloading the image to local disk first
                // and uploading to the input[type=file] selector. We can skip/log to keep automation robust.
            }

            // Click "Далее" (Next) or "Настройки публикации" (Publication Settings)
            console.log('[PuppeteerPublisher] Progressing to publication settings...');
            const clickedNext = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const nextBtn = buttons.find((b) => {
                    const txt = b.textContent?.trim() || '';
                    return txt.includes('Далее') || txt.includes('Настройки публикации') || txt.includes('Next');
                });
                if (nextBtn) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (!clickedNext) {
                throw new Error('Could not find Next button to configure Habr publication');
            }

            // Wait for Settings Dialog/Drawer
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Select sandbox/hubs if required.
            // On Habr, if it's the sandbox, it automatically checks sandbox.
            // We click the final publish button.
            console.log('[PuppeteerPublisher] Clicking final publish button...');
            const clickedPublish = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                const pubBtn = buttons.find((b) => {
                    const txt = b.textContent?.trim() || '';
                    return txt.includes('Опубликовать') || txt.includes('Отправить в песочницу') || txt.includes('Publish') || txt.includes('Post');
                });
                if (pubBtn) {
                    (pubBtn as HTMLButtonElement).click();
                    return true;
                }
                return false;
            });

            if (!clickedPublish) {
                throw new Error('Could not find the final Publish button on Habr');
            }

            // Wait for redirect to published page
            console.log('[PuppeteerPublisher] Waiting for redirect/publication success...');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
            
            const finalUrl = page.url();
            console.log(`[PuppeteerPublisher] Habr publication success! URL: ${finalUrl}`);
            await browser.close();
            return finalUrl;

        } catch (err: any) {
            const screenshotFile = await this.saveErrorScreenshot(page, 'habr');
            await browser.close();
            throw new Error(`Habr Puppeteer automation failed: ${err.message} (Diagnostic screenshot: logs/${screenshotFile})`);
        }
    }

    /**
     * Publish an article to Yandex Dzen using Puppeteer.
     */
    async publishToDzen(
        config: DzenPublishConfig,
        title: string,
        text: string,
        imageUrl?: string,
        publicationType: DzenPublicationType = 'article'
    ): Promise<string> {
        console.log('[PuppeteerPublisher] Initializing Dzen publication...');
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            // Apply the authenticated session to Dzen and the Yandex passport domains.
            const cookiesMain = this.parseCookieString(config.cookies, 'dzen.ru');
            const cookiesDot = this.parseCookieString(config.cookies, '.dzen.ru');
            const cookiesYandex = this.parseCookieString(config.cookies, '.yandex.ru');
            
            if (cookiesMain.length === 0) {
                throw new Error('Dzen cookie string is empty or invalid');
            }

            await page.setCookie(...cookiesMain, ...cookiesDot, ...cookiesYandex);

            console.log('[PuppeteerPublisher] Opening Dzen composer from the channel publications page...');
            await this.openDzenComposer(page, config, publicationType);

            await this.assertDzenAuthenticated(page);

            if (publicationType === 'article') {
                console.log('[PuppeteerPublisher] Filling title...');
                const titleEl = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleTitle, { timeout: 15000 });
                if (!titleEl) throw new Error('Could not find Dzen title input block');
                await typeDzenContentEditableText(titleEl, title);
            }

            // Move to body editor
            console.log('[PuppeteerPublisher] Filling body text...');
            const bodySelector = publicationType === 'article'
                ? DZEN_EDITOR_SELECTORS.articleBody
                : '[contenteditable="true"][role="textbox"]';
            const bodyEl = await page.waitForSelector(bodySelector, { timeout: 15000 });
            if (!bodyEl) throw new Error('Could not find Dzen content body editor block');

            await typeDzenContentEditableText(bodyEl, text);

            await new Promise((resolve) => setTimeout(resolve, 2000));

            if (imageUrl) {
                console.log('[PuppeteerPublisher] Uploading Dzen image...');
                await this.uploadDzenImage(page, imageUrl);
            }

            const existingPublicUrls = new Set(
                (await this.listPublicDzenUrls(page)).filter((url) => this.isPublicDzenUrl(url))
            );

            // Click "Опубликовать" (Publish) button in editor header
            console.log('[PuppeteerPublisher] Triggering Dzen publication modal...');
            const clickedPubHeader = publicationType === 'article'
                ? Boolean(await page.$eval(DZEN_EDITOR_SELECTORS.articlePublish, (button: any) => {
                    button.click();
                    return true;
                }).catch(() => false))
                : await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const btn = buttons.find((b) => {
                    const txt = b.textContent?.trim() || '';
                    return txt.includes('Опубликовать') || txt.includes('Publish') || txt.includes('Далее');
                });
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            if (!clickedPubHeader) {
                throw new Error('Could not find initial Publish button in Dzen Editor');
            }

            // Wait for drawer/drawer settings to overlay
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Optional: Click the final publish confirmation inside the settings drawer
            console.log('[PuppeteerPublisher] Confirming publication in drawer settings...');
            const clickedConfirm = await page.evaluate(() => {
                // Find all buttons inside the sidebar/drawer.
                // Yandex Dzen studio sidebar has button elements for final submit.
                const buttons = Array.from(document.querySelectorAll('button'));
                const btn = buttons.find((b) => {
                    const txt = b.textContent?.trim() || '';
                    // The final confirm button usually has text "Опубликовать" as well or "Опубликовать сейчас"
                    return txt === 'Опубликовать' || txt.includes('Опубликовать сейчас') || txt === 'Publish';
                });
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            });

            if (!clickedConfirm) {
                throw new Error('Could not find confirmation Publish button in Dzen Settings panel');
            }

            // Wait for publication and require an actual public permalink.
            console.log('[PuppeteerPublisher] Waiting for Dzen success response...');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45_000 }).catch(() => {});
            await this.assertDzenAuthenticated(page);
            const publishedUrl = await this.findDzenPublishedUrl(page, existingPublicUrls);
            if (!publishedUrl) {
                throw new Error('Dzen publication could not be verified: no public permalink was found');
            }
            console.log(`[PuppeteerPublisher] Dzen publication success! URL: ${publishedUrl}`);
            await browser.close();
            return publishedUrl;

        } catch (err: any) {
            const screenshotFile = await this.saveErrorScreenshot(page, 'dzen');
            await browser.close();
            throw new Error(`Dzen Puppeteer automation failed: ${err.message} (Diagnostic screenshot: logs/${screenshotFile})`);
        }
    }

    async testDzenConnection(config: DzenPublishConfig) {
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        try {
            const cookies = [
                ...this.parseCookieString(config.cookies, 'dzen.ru'),
                ...this.parseCookieString(config.cookies, '.dzen.ru'),
                ...this.parseCookieString(config.cookies, '.yandex.ru')
            ];
            if (cookies.length === 0) throw new Error('Dzen cookie string is empty or invalid');
            await page.setCookie(...cookies);
            const editorUrl = this.dzenChannelEditorUrl(config);
            await page.goto(editorUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
            await this.assertDzenAuthenticated(page);
            const currentUrl = page.url();
            const editorRouteFound = /dzen\.ru\/profile\/editor\/id\//.test(currentUrl);
            const editorControlFound = Boolean(await page.$('[contenteditable="true"], textarea, [data-placeholder="Заголовок"], button'));
            if (!editorRouteFound || !editorControlFound) {
                throw new Error(`Dzen channel editor is unavailable at ${currentUrl}. Verify the channel ID and account access.`);
            }
            return {
                authenticated: true,
                editor_available: true,
                editor_url: currentUrl,
                checked_at: new Date().toISOString()
            };
        } finally {
            await browser.close();
        }
    }
}

export default new PuppeteerPublisherService();
