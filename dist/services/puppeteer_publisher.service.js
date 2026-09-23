"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreDzenCommentComposer = scoreDzenCommentComposer;
exports.scoreDzenCommentSubmit = scoreDzenCommentSubmit;
exports.navigateDzenInteractionPage = navigateDzenInteractionPage;
exports.extractDzenStudioMetrics = extractDzenStudioMetrics;
exports.parseDzenCookieString = parseDzenCookieString;
const puppeteer_1 = __importDefault(require("puppeteer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("dns/promises"));
const net_1 = __importDefault(require("net"));
const COMMENT_WORDS = /коммент|comment|ответ|reply|обсуждени/i;
const SEND_WORDS = /^(?:отправить|опубликовать|комментировать|ответить|send|publish|reply)$/i;
const EXCLUDED_EDITOR_WORDS = /поиск|search|заголов|title|описани|description/i;
function scoreDzenCommentComposer(candidate) {
    const editable = candidate.tag === 'textarea'
        || (candidate.tag === 'input' && (!candidate.type || ['text', 'search'].includes(candidate.type)))
        || candidate.role === 'textbox'
        || candidate.contentEditable === 'true';
    if (!editable || candidate.disabled)
        return -100;
    const ownText = [candidate.placeholder, candidate.ariaLabel, candidate.dataTestId].filter(Boolean).join(' ');
    const allText = `${ownText} ${candidate.context || ''}`;
    if (EXCLUDED_EDITOR_WORDS.test(ownText) && !COMMENT_WORDS.test(allText))
        return -50;
    let score = candidate.tag === 'textarea' ? 4 : candidate.contentEditable === 'true' ? 3 : 1;
    if (candidate.role === 'textbox')
        score += 2;
    if (COMMENT_WORDS.test(ownText))
        score += 12;
    else if (COMMENT_WORDS.test(candidate.context || ''))
        score += 7;
    if (candidate.dataTestId && /comment|reply/i.test(candidate.dataTestId))
        score += 8;
    return score;
}
function scoreDzenCommentSubmit(candidate) {
    if (candidate.disabled || !['button', 'div', 'span'].includes(candidate.tag))
        return -100;
    const ownText = [candidate.text, candidate.ariaLabel, candidate.dataTestId].filter(Boolean).join(' ').trim();
    let score = SEND_WORDS.test(ownText) ? 12 : 0;
    if (candidate.role === 'button' || candidate.tag === 'button')
        score += 3;
    if (/comment|reply/i.test(candidate.dataTestId || ''))
        score += 6;
    if (COMMENT_WORDS.test(candidate.context || ''))
        score += 4;
    return score;
}
async function navigateDzenInteractionPage(page, url, timeout = 30000) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForFunction(() => Boolean(document.body) && document.readyState !== 'loading', { timeout: Math.min(timeout, 5000) });
}
function extractDzenStudioMetrics(payload, postUrl) {
    let pathname;
    try {
        pathname = new URL(postUrl).pathname.replace(/\/$/, '');
    }
    catch {
        return null;
    }
    const publication = (payload?.publications || []).find((entry) => typeof entry?.commonUrl === 'string' && entry.commonUrl.replace(/\/$/, '') === pathname);
    if (!publication?.id)
        return null;
    const counters = (payload?.publicationCounters || []).find((entry) => entry?.publicationId === publication.id) || {};
    const social = (payload?.socialCounters || []).find((entry) => entry?.publicationId === publication.id) || {};
    const numberOrNull = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    return {
        views: numberOrNull(counters.views),
        likes: numberOrNull(social.likeCount),
        comments: numberOrNull(social.commentCount),
        impressions: numberOrNull(counters.impressions),
        pageViews: numberOrNull(counters.pageViews),
        clicks: numberOrNull(counters.clicks),
        deepViews: numberOrNull(counters.deepViews),
        shares: numberOrNull(counters.shares),
        subscriptions: numberOrNull(counters.subscriptions),
        sumViewTimeSec: numberOrNull(counters.sumViewTimeSec),
        ctr: numberOrNull(counters.ctr)
    };
}
const COOKIE_ATTRIBUTE_NAMES = new Set([
    'domain', 'expires', 'httponly', 'max-age', 'partitioned', 'path', 'priority', 'samesite', 'secure'
]);
/**
 * Convert a copied browser Cookie header into a CDP-compatible cookie list.
 * The UI intentionally accepts both the raw header value and a value prefixed
 * with `Cookie:` so an owner can paste directly from DevTools.
 */
function parseDzenCookieString(cookieStr, domain) {
    const normalizedDomain = domain.trim();
    const cookieHeader = cookieStr
        .replace(/^\s*cookie\s*:\s*/i, '')
        .replace(/\r?\n\s*/g, ' ')
        .trim();
    return cookieHeader
        .split(';')
        .map((item) => {
        const trimmed = item.trim();
        const index = trimmed.indexOf('=');
        if (index <= 0)
            return null;
        const name = trimmed.substring(0, index).trim();
        const value = trimmed.substring(index + 1).trim();
        const lowerName = name.toLowerCase();
        const validName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
        if (!validName || !value || COOKIE_ATTRIBUTE_NAMES.has(lowerName) || name.startsWith('$'))
            return null;
        if (name.startsWith('__Host-')) {
            return {
                name,
                value,
                url: `https://${normalizedDomain.replace(/^\./, '')}/`,
                path: '/',
                secure: true
            };
        }
        return {
            name,
            value,
            domain: normalizedDomain,
            path: '/',
            ...(name.startsWith('__Secure-') ? { secure: true } : {})
        };
    })
        .filter((cookie) => cookie !== null);
}
class PuppeteerPublisherService {
    async prepareDzenPage(page, config) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        if (!config.cookies?.trim())
            return;
        const cookies = [
            ...this.parseCookieString(config.cookies, 'dzen.ru'),
            ...this.parseCookieString(config.cookies, '.dzen.ru'),
            ...this.parseCookieString(config.cookies, '.yandex.ru')
        ];
        if (cookies.length > 0)
            await page.setCookie(...cookies);
    }
    dzenChannelId(config) {
        const candidate = config.channel_id?.trim() || config.channel_url?.trim() || '';
        if (!candidate)
            return null;
        const directId = candidate.match(/^[a-zA-Z0-9_-]+$/)?.[0];
        if (directId)
            return directId;
        try {
            const url = new URL(candidate);
            if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname))
                return null;
            return url.pathname.match(/\/(?:id|profile\/editor\/id)\/([^/?#]+)/)?.[1] || null;
        }
        catch {
            return null;
        }
    }
    dzenChannelEditorUrl(config) {
        const channelId = this.dzenChannelId(config);
        return channelId
            ? `https://dzen.ru/profile/editor/id/${encodeURIComponent(channelId)}`
            : (config.article_editor_url || 'https://dzen.ru/studio/editor/create/article');
    }
    /**
     * Parse raw browser Cookie header string into Puppeteer-compliant cookies.
     */
    parseCookieString(cookieStr, domain) {
        return parseDzenCookieString(cookieStr, domain);
    }
    /**
     * Launch a standard Puppeteer browser instance.
     */
    async launchBrowser() {
        return await puppeteer_1.default.launch({
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
    async saveErrorScreenshot(page, platform) {
        try {
            const timestamp = Date.now();
            const logsDir = path_1.default.join(process.cwd(), 'logs');
            if (!fs_1.default.existsSync(logsDir)) {
                fs_1.default.mkdirSync(logsDir, { recursive: true });
            }
            const filename = `puppeteer-error-${platform}-${timestamp}.png`;
            const screenshotPath = path_1.default.join(logsDir, filename);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.error(`[PuppeteerPublisher] Diagnostic screenshot saved to ${screenshotPath}`);
            return filename;
        }
        catch (e) {
            console.error('[PuppeteerPublisher] Failed to take diagnostic screenshot:', e.message);
            return 'screenshot-failed';
        }
    }
    async assertDzenAuthenticated(page) {
        const currentUrl = page.url();
        const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
        if (currentUrl.includes('/login')
            || currentUrl.includes('passport.yandex.ru')
            || /войти|авторизуйтесь|sign in/i.test(pageText.slice(0, 1200))) {
            throw new Error('Dzen authentication failed: the saved session is invalid or expired');
        }
        if (/captcha|подтвердите, что вы не робот|робот/i.test(`${currentUrl}\n${pageText}`)) {
            throw new Error('Dzen requires a CAPTCHA or interactive account verification');
        }
    }
    isPublicDzenUrl(value) {
        try {
            const url = new URL(value);
            return ['dzen.ru', 'www.dzen.ru'].includes(url.hostname)
                && !url.pathname.startsWith('/studio')
                && !url.pathname.includes('/editor/')
                && !/\bmock[-_/]/i.test(url.pathname)
                && (/\/(?:a|b)\//.test(url.pathname) || /\/media\/id\//.test(url.pathname));
        }
        catch {
            return false;
        }
    }
    async uploadDzenImage(page, imageUrl) {
        const url = new URL(imageUrl);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new Error('Dzen image URL must be an authenticated-free HTTPS URL');
        }
        if (['localhost', 'metadata.google.internal'].includes(url.hostname.toLowerCase())) {
            throw new Error('Dzen image URL points to a forbidden host');
        }
        const addresses = await promises_1.default.lookup(url.hostname, { all: true });
        if (addresses.length === 0 || addresses.some(({ address }) => this.isPrivateNetworkAddress(address))) {
            throw new Error('Dzen image URL resolves to a private or unavailable network address');
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
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
        if (!response.body)
            throw new Error('Dzen image response body is empty');
        const chunks = [];
        let totalBytes = 0;
        for await (const chunk of response.body) {
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
        const tempPath = path_1.default.join(process.cwd(), 'logs', `dzen-upload-${Date.now()}.${extension}`);
        fs_1.default.mkdirSync(path_1.default.dirname(tempPath), { recursive: true });
        fs_1.default.writeFileSync(tempPath, bytes);
        try {
            let input = await page.$('input[type="file"][accept*="image"], input[type="file"]');
            if (!input) {
                await page.evaluate(() => {
                    const controls = Array.from(document.querySelectorAll('button, [role="button"]'));
                    const imageControl = controls.find((element) => {
                        const label = `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`;
                        return /изображ|картин|фото|image|photo/i.test(label);
                    });
                    imageControl?.click();
                });
                input = await page.waitForSelector('input[type="file"][accept*="image"], input[type="file"]', { timeout: 10000 });
            }
            if (!input)
                throw new Error('Dzen image upload control was not found');
            await input.uploadFile(tempPath);
            await page.waitForFunction(() => Boolean(document.querySelector('img[src^="blob:"], img[src*="avatars"], img[src*="dzeninfra"]')), { timeout: 20000 }).catch(() => undefined);
        }
        finally {
            fs_1.default.rmSync(tempPath, { force: true });
        }
    }
    isPrivateNetworkAddress(address) {
        if (net_1.default.isIPv4(address)) {
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
    async listPublicDzenUrls(page) {
        return page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((link) => link.href));
    }
    async findDzenPublishedUrl(page, previousUrls) {
        const current = page.url();
        if (this.isPublicDzenUrl(current))
            return current;
        const candidate = await page.evaluate((excluded) => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            return links.map((link) => link.href).find((href) => {
                if (excluded.includes(href))
                    return false;
                try {
                    const url = new URL(href);
                    return ['dzen.ru', 'www.dzen.ru'].includes(url.hostname)
                        && !url.pathname.startsWith('/studio')
                        && !url.pathname.includes('/editor/')
                        && !/\bmock[-_/]/i.test(url.pathname)
                        && (/\/(?:a|b)\//.test(url.pathname) || /\/media\/id\//.test(url.pathname));
                }
                catch {
                    return false;
                }
            }) || null;
        }, Array.from(previousUrls));
        return candidate && this.isPublicDzenUrl(candidate) ? candidate : null;
    }
    /**
     * Publish an article to Habr.com using Puppeteer.
     */
    async publishToHabr(config, title, text, imageUrl) {
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
            if (!titleEl)
                throw new Error('Could not find Habr title input field');
            await titleEl.focus();
            await page.evaluate((el, t) => {
                el.value = t;
                const evt = document.createEvent('HTMLEvents');
                evt.initEvent('input', true, true);
                el.dispatchEvent(evt);
            }, titleEl, title);
            // Fill Content body
            console.log('[PuppeteerPublisher] Filling body content...');
            const bodySelector = '[contenteditable="true"], .editor__input, .ce-element';
            const bodyEl = await page.waitForSelector(bodySelector, { timeout: 15000 });
            if (!bodyEl)
                throw new Error('Could not find Habr content editable editor body');
            await bodyEl.focus();
            await page.evaluate((el, markdownText) => {
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
                    pubBtn.click();
                    return true;
                }
                return false;
            });
            if (!clickedPublish) {
                throw new Error('Could not find the final Publish button on Habr');
            }
            // Wait for redirect to published page
            console.log('[PuppeteerPublisher] Waiting for redirect/publication success...');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => { });
            const finalUrl = page.url();
            console.log(`[PuppeteerPublisher] Habr publication success! URL: ${finalUrl}`);
            await browser.close();
            return finalUrl;
        }
        catch (err) {
            const screenshotFile = await this.saveErrorScreenshot(page, 'habr');
            await browser.close();
            throw new Error(`Habr Puppeteer automation failed: ${err.message} (Diagnostic screenshot: logs/${screenshotFile})`);
        }
    }
    /**
     * Publish an article to Yandex Dzen using Puppeteer.
     */
    async publishToDzen(config, title, text, imageUrl, publicationType = 'article') {
        console.log('[PuppeteerPublisher] Initializing Dzen publication...');
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });
        try {
            // Apply the authenticated session to Dzen and the Yandex passport domains.
            const cookieString = config.cookies || '';
            const cookiesMain = this.parseCookieString(cookieString, 'dzen.ru');
            const cookiesDot = this.parseCookieString(cookieString, '.dzen.ru');
            const cookiesYandex = this.parseCookieString(cookieString, '.yandex.ru');
            if (cookiesMain.length === 0) {
                throw new Error('Dzen cookie string is empty or invalid');
            }
            await page.setCookie(...cookiesMain, ...cookiesDot, ...cookiesYandex);
            const studioUrl = publicationType === 'article'
                ? (config.article_editor_url || 'https://dzen.ru/studio/editor/create/article')
                : (config.post_editor_url || 'https://dzen.ru/studio/editor/create/post');
            console.log(`[PuppeteerPublisher] Navigating to ${studioUrl}`);
            await page.goto(studioUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.assertDzenAuthenticated(page);
            if (publicationType === 'article') {
                console.log('[PuppeteerPublisher] Filling title...');
                const titleSelector = '[placeholder="Заголовок"], div[data-placeholder="Заголовок"], .editor__title-input, h1[contenteditable="true"]';
                const titleEl = await page.waitForSelector(titleSelector, { timeout: 15000 });
                if (!titleEl)
                    throw new Error('Could not find Dzen title input block');
                await titleEl.focus();
                await page.evaluate((el, t) => {
                    el.focus();
                    document.execCommand('selectAll', false, undefined);
                    document.execCommand('insertText', false, t);
                }, titleEl, title);
            }
            // Move to body editor
            console.log('[PuppeteerPublisher] Filling body text...');
            const bodySelector = '[contenteditable="true"]:not([placeholder="Заголовок"]):not(h1), .editor__body [contenteditable="true"], .editor__content';
            const bodyEl = await page.waitForSelector(bodySelector, { timeout: 15000 });
            if (!bodyEl)
                throw new Error('Could not find Dzen content body editor block');
            await bodyEl.focus();
            await page.evaluate((el, markdownText) => {
                el.focus();
                document.execCommand('selectAll', false, undefined);
                document.execCommand('insertText', false, markdownText);
            }, bodyEl, text);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            if (imageUrl) {
                console.log('[PuppeteerPublisher] Uploading Dzen image...');
                await this.uploadDzenImage(page, imageUrl);
            }
            const existingPublicUrls = new Set((await this.listPublicDzenUrls(page)).filter((url) => this.isPublicDzenUrl(url)));
            // Click "Опубликовать" (Publish) button in editor header
            console.log('[PuppeteerPublisher] Triggering Dzen publication modal...');
            const clickedPubHeader = await page.evaluate(() => {
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
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => { });
            await this.assertDzenAuthenticated(page);
            const publishedUrl = await this.findDzenPublishedUrl(page, existingPublicUrls);
            if (!publishedUrl) {
                throw new Error('Dzen publication could not be verified: no public permalink was found');
            }
            console.log(`[PuppeteerPublisher] Dzen publication success! URL: ${publishedUrl}`);
            await browser.close();
            return publishedUrl;
        }
        catch (err) {
            const screenshotFile = await this.saveErrorScreenshot(page, 'dzen');
            await browser.close();
            throw new Error(`Dzen Puppeteer automation failed: ${err.message} (Diagnostic screenshot: logs/${screenshotFile})`);
        }
    }
    async testDzenConnection(config) {
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        try {
            const cookieString = config.cookies || '';
            const cookies = [
                ...this.parseCookieString(cookieString, 'dzen.ru'),
                ...this.parseCookieString(cookieString, '.dzen.ru'),
                ...this.parseCookieString(cookieString, '.yandex.ru')
            ];
            if (cookies.length === 0)
                throw new Error('Dzen cookie string is empty or invalid');
            await page.setCookie(...cookies);
            const editorUrl = this.dzenChannelEditorUrl(config);
            await page.goto(editorUrl, { waitUntil: 'networkidle2', timeout: 30000 });
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
        }
        finally {
            await browser.close();
        }
    }
    async collectDzenPostMetrics(config, postUrl) {
        if (!this.isPublicDzenUrl(postUrl))
            throw new Error('INVALID_DZEN_POST_URL');
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        try {
            await this.prepareDzenPage(page, config);
            if (config.cookies?.trim() && this.dzenChannelId(config)) {
                const responsePromise = page.waitForResponse((response) => /\/editor-api\/v3\/publications\?/.test(response.url()) && response.status() === 200, { timeout: 30000 });
                await page.goto(this.dzenChannelEditorUrl(config), { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.assertDzenAuthenticated(page);
                const payload = await (await responsePromise).json();
                const studioMetrics = extractDzenStudioMetrics(payload, postUrl);
                if (studioMetrics)
                    return studioMetrics;
            }
            await navigateDzenInteractionPage(page, postUrl);
            await this.waitForDzenAuthenticatedPage(page);
            return await page.evaluate(() => {
                const normalize = (value) => value.replace(/\u00a0/g, ' ').trim();
                const candidates = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], [title]'))
                    .map((node) => normalize(`${node.innerText || ''} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`));
                const find = (pattern) => candidates.find((value) => pattern.test(value)) || '';
                const body = normalize(document.body?.innerText || '');
                const metric = (label, fallback) => {
                    const source = find(label);
                    const match = source.match(/\d[\d\s.,]*(?:тыс\.?|млн|[kкmм])?/i) || body.match(fallback);
                    return match?.[0] || null;
                };
                return {
                    views: metric(/просмотр|view/i, /([\d\s.,]+(?:тыс\.?|млн|[kкmм])?)\s*(?:просмотр|view)/i),
                    likes: metric(/нрав|лайк|like/i, /([\d\s.,]+(?:тыс\.?|млн|[kкmм])?)\s*(?:лайк|like|нрав)/i),
                    comments: metric(/коммент|comment/i, /([\d\s.,]+(?:тыс\.?|млн|[kкmм])?)\s*(?:коммент|comment)/i)
                };
            });
        }
        finally {
            await browser.close();
        }
    }
    async searchDzenPosts(config, query, limit) {
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        try {
            await this.prepareDzenPage(page, config);
            await page.goto(`https://dzen.ru/search?query=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.assertDzenAuthenticated(page);
            const results = await page.evaluate((maxResults) => {
                const seen = new Set();
                const output = [];
                for (const link of Array.from(document.querySelectorAll('a[href]'))) {
                    const url = link.href;
                    if (seen.has(url) || !/dzen\.ru\/(?:a|b|media\/id)\//.test(url))
                        continue;
                    const card = link.closest('article') || link.closest('[data-testid]') || link.parentElement;
                    const text = (card?.textContent || link.textContent || '').replace(/\s+/g, ' ').trim();
                    const heading = card?.querySelector('h1, h2, h3, [role="heading"]')?.textContent?.trim();
                    seen.add(url);
                    output.push({ url, title: (heading || link.textContent || '').trim().slice(0, 300), snippet: text.slice(0, 700) });
                    if (output.length >= maxResults)
                        break;
                }
                return output;
            }, limit);
            if (results.length === 0)
                throw new Error('DZEN_SEARCH_INTERFACE_CHANGED');
            return results;
        }
        finally {
            await browser.close();
        }
    }
    async commentOnDzenPost(config, postUrl, comment) {
        if (!config.cookies?.trim())
            throw new Error('DZEN_AUTH_REQUIRED');
        if (!this.isPublicDzenUrl(postUrl))
            throw new Error('INVALID_DZEN_POST_URL');
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        try {
            await this.prepareDzenPage(page, config);
            await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.assertDzenAuthenticated(page);
            await this.revealDzenComments(page);
            const alreadyExists = await page.evaluate((text) => (document.body?.innerText || '').includes(text), comment);
            if (alreadyExists)
                return { status: 'already_exists', url: postUrl };
            const controls = await this.waitForDzenCommentControls(page, true, false);
            const editor = controls.editor;
            if (!editor)
                throw new Error('DZEN_COMMENT_INTERFACE_CHANGED: composer is unavailable');
            await editor.click();
            await page.keyboard.type(comment, { delay: 5 });
            const refreshed = await this.waitForDzenCommentControls(page, false, true);
            if (!refreshed.submit)
                throw new Error('DZEN_COMMENT_INTERFACE_CHANGED: send control is unavailable');
            await refreshed.submit.click();
            await this.waitForDzenCommentReadback(page, comment);
            return { status: 'published', url: postUrl };
        }
        finally {
            await browser.close();
        }
    }
    async preflightDzenComment(config, postUrl) {
        if (!config.cookies?.trim())
            throw new Error('DZEN_AUTH_REQUIRED');
        if (!this.isPublicDzenUrl(postUrl))
            throw new Error('INVALID_DZEN_POST_URL');
        const browser = await this.launchBrowser();
        const page = await browser.newPage();
        try {
            await this.prepareDzenPage(page, config);
            await navigateDzenInteractionPage(page, postUrl);
            await this.waitForDzenAuthenticatedPage(page);
            await this.revealDzenComments(page);
            let controls = await this.waitForDzenCommentControls(page, true, false);
            if (controls.editor && !controls.submit) {
                await controls.editor.click().catch(() => undefined);
                await new Promise((resolve) => setTimeout(resolve, 350));
                controls = await this.waitForDzenCommentControls(page, false, false);
            }
            return controls.editor && controls.submit
                ? { status: 'ready', composer_available: true, send_control_available: true }
                : {
                    status: 'interface_changed',
                    composer_available: Boolean(controls.editor),
                    send_control_available: Boolean(controls.submit)
                };
        }
        finally {
            await browser.close();
        }
    }
    async waitForDzenAuthenticatedPage(page) {
        await page.waitForFunction(() => Boolean(document.body) && document.readyState !== 'loading', { timeout: 5000 });
        await this.assertDzenAuthenticated(page);
    }
    async waitForDzenCommentReadback(page, comment) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            for (const frame of page.frames()) {
                try {
                    const confirmed = await frame.evaluate((expected) => {
                        const normalize = (value) => value.replace(/\s+/g, ' ').trim();
                        const target = normalize(expected);
                        const roots = [document];
                        for (let i = 0; i < roots.length; i++) {
                            const root = roots[i];
                            for (const element of Array.from(root.querySelectorAll('p, span, div, article, li'))) {
                                if (element.closest('[contenteditable]:not([contenteditable="false"]), textarea, input'))
                                    continue;
                                if (element.children.length > 0)
                                    continue;
                                if (normalize(element.innerText || element.textContent || '') === target)
                                    return true;
                            }
                            for (const element of Array.from(root.querySelectorAll('*'))) {
                                if (element.shadowRoot)
                                    roots.push(element.shadowRoot);
                            }
                        }
                        return false;
                    }, comment);
                    if (confirmed)
                        return;
                }
                catch {
                    // Dzen replaces lazy-loaded frames; retry against the current frame set.
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error('DZEN_COMMENT_PROVIDER_CONFIRMATION_TIMEOUT');
    }
    async revealDzenComments(page) {
        await page.evaluate(async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const viewport = Math.max(window.innerHeight, 600);
            for (let top = 0; top < document.documentElement.scrollHeight; top += viewport) {
                window.scrollTo(0, top);
                await delay(80);
            }
            window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await new Promise((resolve) => setTimeout(resolve, 750));
        await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }).catch(() => undefined);
    }
    async waitForDzenCommentControls(page, openPanel, requireSubmitEnabled, timeout = 15000) {
        let controls = { editor: null, submit: null };
        const deadline = Date.now() + timeout;
        let attempt = 0;
        do {
            controls = await this.findDzenCommentControls(page, openPanel && attempt === 0, requireSubmitEnabled);
            if (controls.editor && controls.submit)
                return controls;
            attempt += 1;
            await new Promise((resolve) => setTimeout(resolve, 750));
        } while (Date.now() < deadline);
        return controls;
    }
    async findDzenCommentControls(page, openPanel, requireSubmitEnabled = false) {
        const frames = page.frames();
        if (openPanel) {
            for (const frame of frames) {
                let opener;
                try {
                    opener = await frame.evaluateHandle(() => {
                        const roots = [document];
                        const nodes = [];
                        for (let i = 0; i < roots.length; i++) {
                            const root = roots[i];
                            nodes.push(...Array.from(root.querySelectorAll('button, [role="button"], [data-testid*="comment" i], [data-testid*="reply" i]')));
                            for (const element of Array.from(root.querySelectorAll('*'))) {
                                if (element.shadowRoot)
                                    roots.push(element.shadowRoot);
                            }
                        }
                        return nodes.find((node) => {
                            const el = node;
                            const value = `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-testid') || ''}`.trim();
                            return /коммент|comment|обсуждени/i.test(value) && el.getAttribute('aria-disabled') !== 'true';
                        }) || null;
                    });
                }
                catch {
                    continue;
                }
                const element = opener.asElement();
                if (element) {
                    await element.click().catch(() => undefined);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    break;
                }
                await opener.dispose();
            }
        }
        for (const frame of page.frames()) {
            let handles;
            try {
                handles = await frame.evaluateHandle(() => {
                    const roots = [document];
                    const candidates = [];
                    for (let i = 0; i < roots.length; i++) {
                        const root = roots[i];
                        candidates.push(...Array.from(root.querySelectorAll('textarea, input, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')));
                        for (const element of Array.from(root.querySelectorAll('*'))) {
                            if (element.shadowRoot)
                                roots.push(element.shadowRoot);
                        }
                    }
                    const descriptor = (el) => ({
                        tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', role: el.getAttribute('role') || '',
                        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
                        ariaLabel: el.getAttribute('aria-label') || '', dataTestId: el.getAttribute('data-testid') || '',
                        contentEditable: String(el.isContentEditable), disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
                        context: el.closest('form, article, section, [data-testid], [class*="comment" i]')?.textContent?.slice(0, 500) || ''
                    });
                    const commentWords = /коммент|comment|ответ|reply|обсуждени/i;
                    const excluded = /поиск|search|заголов|title|описани|description/i;
                    const score = (el) => {
                        const d = descriptor(el);
                        const editable = d.tag === 'textarea' || (d.tag === 'input' && (!d.type || ['text', 'search'].includes(d.type))) || d.role === 'textbox' || d.contentEditable === 'true';
                        if (!editable || d.disabled)
                            return -100;
                        const own = `${d.placeholder} ${d.ariaLabel} ${d.dataTestId}`;
                        const all = `${own} ${d.context}`;
                        if (excluded.test(own) && !commentWords.test(all))
                            return -50;
                        return (d.tag === 'textarea' ? 4 : d.contentEditable === 'true' ? 3 : 1) + (d.role === 'textbox' ? 2 : 0) + (commentWords.test(own) ? 12 : commentWords.test(d.context) ? 7 : 0) + (/comment|reply/i.test(d.dataTestId) ? 8 : 0);
                    };
                    return candidates.map((el) => ({ el, score: score(el) })).filter((entry) => entry.score >= 3).sort((a, b) => b.score - a.score)[0]?.el || null;
                });
            }
            catch {
                continue;
            }
            const editor = handles.asElement();
            if (!editor) {
                await handles.dispose();
                continue;
            }
            let submitHandle;
            try {
                submitHandle = await frame.evaluateHandle((mustBeEnabled) => {
                    const roots = [document];
                    const candidates = [];
                    for (let i = 0; i < roots.length; i++) {
                        const root = roots[i];
                        candidates.push(...Array.from(root.querySelectorAll('button, [role="button"]')));
                        for (const el of Array.from(root.querySelectorAll('*')))
                            if (el.shadowRoot)
                                roots.push(el.shadowRoot);
                    }
                    return candidates.find((el) => {
                        const named = /^(отправить|опубликовать|комментировать|ответить|send|publish|reply)$/i.test(`${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`.trim())
                            || /(?:comment|reply).*(?:send|submit|publish)|(?:send|submit|publish).*(?:comment|reply)/i.test(el.getAttribute('data-testid') || '');
                        const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
                        return named && (!mustBeEnabled || !disabled);
                    }) || null;
                }, requireSubmitEnabled);
            }
            catch {
                await handles.dispose();
                continue;
            }
            return { editor, submit: submitHandle.asElement() };
        }
        return { editor: null, submit: null };
    }
}
exports.default = new PuppeteerPublisherService();
