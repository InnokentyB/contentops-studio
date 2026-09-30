import { createHash } from 'crypto';
import type { Page } from 'puppeteer';
import type { DzenDraftFinalizationInput } from '../dzen.service';
import { DZEN_EDITOR_SELECTORS, type BrowserCookie } from './dzen_dom_helpers';

type Config = { cookies?: string; channel_id?: string; channel_url?: string };

type Dependencies = {
    launchBrowser(): Promise<any>;
    parseCookies(cookieString: string, domain: string): BrowserCookie[];
    assertAuthenticated(page: Page): Promise<void>;
    isPublicUrl(value: string): boolean;
    saveErrorScreenshot(page: Page, platform: string): Promise<string>;
    channelId(config: Config): string | null;
};

function draftIdentity(deps: Dependencies, config: Config, draftEditorUrl: string) {
    const channelId = deps.channelId(config);
    if (!channelId) throw new Error('[DZEN_DRAFT_IDENTITY_INVALID] Configured channel ID is required');
    let url: URL;
    try {
        url = new URL(draftEditorUrl);
    } catch {
        throw new Error('[DZEN_DRAFT_IDENTITY_INVALID] Draft editor URL is invalid');
    }
    const match = url.pathname.match(/^\/profile\/editor\/id\/([^/]+)\/([^/]+)\/edit\/?$/);
    if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname)
        || url.protocol !== 'https:'
        || url.username
        || url.password
        || !match
        || decodeURIComponent(match[1]) !== channelId) {
        throw new Error('[DZEN_DRAFT_IDENTITY_INVALID] Exact configured-channel draft editor URL required');
    }
    const draftId = decodeURIComponent(match[2]);
    return {
        channelId,
        draftId,
        editorUrl: `https://dzen.ru/profile/editor/id/${encodeURIComponent(channelId)}/${encodeURIComponent(draftId)}/edit`,
        editorPath: `/profile/editor/id/${encodeURIComponent(channelId)}/${encodeURIComponent(draftId)}/edit`
    };
}

async function matchingDraft(page: Page, deps: Dependencies, config: Config, input: DzenDraftFinalizationInput) {
    const identity = draftIdentity(deps, config, input.draftEditorUrl);
    const draftsUrl = `https://dzen.ru/profile/editor/id/${encodeURIComponent(identity.channelId)}/publications?state=draft`;
    await page.goto(draftsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await deps.assertAuthenticated(page);
    await page.waitForFunction(() => Boolean(document.body) && document.readyState !== 'loading', { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const matches = await page.evaluate(({ expectedTitle, editorPath }) => {
        const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
        const unique = new Map<string, { href: string; title: string }>();
        for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
            let url: URL;
            try { url = new URL(anchor.href); } catch { continue; }
            if (!/^\/profile\/editor\/id\/[^/]+\/[^/]+\/edit\/?$/.test(url.pathname)) continue;
            const text = normalize(anchor.innerText || anchor.textContent || '');
            if (!text.includes(expectedTitle)) continue;
            const path = url.pathname.replace(/\/$/, '');
            unique.set(path, { href: `${url.origin}${path}`, title: text });
        }
        return { candidates: Array.from(unique.values()), exact_match: unique.get(editorPath) || null };
    }, { expectedTitle: input.expectedTitle, editorPath: identity.editorPath });
    if (matches.candidates.length !== 1 || !matches.exact_match) {
        throw new Error(`[DZEN_DRAFT_MATCH_COUNT_MISMATCH] Expected one exact matching draft; found ${matches.candidates.length}`);
    }
    return { identity, matchedDraftCount: matches.candidates.length };
}

async function clickVisibleControl(page: Page, selector: string, label: string) {
    const candidates = await page.$$(selector);
    for (const candidate of candidates) {
        const visible = await candidate.evaluate((element) => {
            const node = element as HTMLElement;
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none'
                && rect.width > 0 && rect.height > 0
                && !(node as HTMLButtonElement).disabled
                && node.getAttribute('aria-disabled') !== 'true';
        });
        const box = visible ? await candidate.boundingBox() : null;
        if (!box) continue;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return;
    }
    throw new Error(`[DZEN_DRAFT_FINALIZE_CONTROL_MISSING] ${label}`);
}

async function findPublishedTitle(page: Page, deps: Dependencies, config: Config, expectedTitle: string) {
    const channelId = deps.channelId(config);
    const publicationsUrl = `https://dzen.ru/profile/editor/id/${encodeURIComponent(channelId!)}/publications`;
    await page.goto(publicationsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await deps.assertAuthenticated(page);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const urls = await page.evaluate((title) => {
        const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
        const matches = new Set<string>();
        for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
            if (!normalize(anchor.innerText || anchor.textContent || '').includes(title)) continue;
            try {
                const url = new URL(anchor.href);
                if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname)) continue;
                if (!/\/(?:a|b)\//.test(url.pathname) && !/\/media\/id\//.test(url.pathname)) continue;
                matches.add(`${url.origin}${url.pathname}`);
            } catch {
                // Ignore malformed provider links.
            }
        }
        return Array.from(matches);
    }, expectedTitle);
    if (urls.length > 1) {
        throw new Error(`[DZEN_PUBLISHED_MATCH_COUNT_MISMATCH] Expected at most one public result; found ${urls.length}`);
    }
    return urls[0] || null;
}

export async function finalizeDzenExistingDraft(
    deps: Dependencies,
    config: Config,
    input: DzenDraftFinalizationInput
) {
    const browser = await deps.launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    try {
        const cookieString = config.cookies || '';
        const cookies = [
            ...deps.parseCookies(cookieString, 'dzen.ru'),
            ...deps.parseCookies(cookieString, '.dzen.ru'),
            ...deps.parseCookies(cookieString, '.yandex.ru')
        ];
        if (cookies.length === 0) throw new Error('Dzen cookie string is empty or invalid');
        await page.setCookie(...cookies);

        const { identity, matchedDraftCount } = await matchingDraft(page, deps, config, input);
        await page.goto(identity.editorUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
        await deps.assertAuthenticated(page);
        const titleElement = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleTitle, { timeout: 15_000 });
        const bodyElement = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleBody, { timeout: 15_000 });
        if (!titleElement || !bodyElement) throw new Error('[DZEN_DRAFT_CONTENT_MISSING] Title or body editor not found');
        const [title, body] = await Promise.all([
            titleElement.evaluate((element: Element) => (element as HTMLElement).innerText.trim()),
            bodyElement.evaluate((element: Element) => (element as HTMLElement).innerText.trim())
        ]);
        const canonicalBodySha256 = createHash('sha256').update(body).digest('hex');
        const hasImage = Boolean(await bodyElement.$('img'));
        if (title !== input.expectedTitle || canonicalBodySha256 !== input.expectedCanonicalBodySha256) {
            throw new Error(`[DZEN_DRAFT_CONTENT_MISMATCH] title_match=${title === input.expectedTitle} body_sha256=${canonicalBodySha256}`);
        }
        if (input.expectedImageUrl && !hasImage) {
            throw new Error('[DZEN_DRAFT_IMAGE_MISSING] Expected revision-bound visual is absent from the draft');
        }
        const baseResult = {
            draft_id: identity.draftId,
            draft_editor_url: identity.editorUrl,
            matched_draft_count: matchedDraftCount,
            canonical_body_sha256: canonicalBodySha256,
            title,
            has_image: hasImage
        };
        if (input.dryRun) return { mode: 'dry_run', ...baseResult };

        const existingPublicUrl = await findPublishedTitle(page, deps, config, input.expectedTitle);
        if (existingPublicUrl) {
            return { mode: 'published', ...baseResult, published_url: existingPublicUrl, replayed: true };
        }
        await page.goto(identity.editorUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
        await deps.assertAuthenticated(page);
        await page.waitForSelector(DZEN_EDITOR_SELECTORS.articlePublish, { timeout: 15_000, visible: true });
        await clickVisibleControl(page, DZEN_EDITOR_SELECTORS.articlePublish, 'initial publish control');
        await page.waitForSelector(DZEN_EDITOR_SELECTORS.publicationConfirm, { timeout: 15_000, visible: true });
        await clickVisibleControl(page, DZEN_EDITOR_SELECTORS.publicationConfirm, 'final publish confirmation');

        let publishedUrl: string | null = null;
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline && !publishedUrl) {
            await new Promise((resolve) => setTimeout(resolve, 5_000));
            publishedUrl = await findPublishedTitle(page, deps, config, input.expectedTitle);
        }
        if (!publishedUrl || !deps.isPublicUrl(publishedUrl)) {
            throw new Error('[DZEN_DRAFT_PERMALINK_NOT_CONFIRMED] Final action did not yield one verified public permalink');
        }
        return { mode: 'published', ...baseResult, published_url: publishedUrl, replayed: false };
    } catch (error: any) {
        const screenshotFile = await deps.saveErrorScreenshot(page, 'dzen-finalize-draft');
        throw new Error(`Dzen existing-draft finalization failed: ${error.message} (Diagnostic screenshot: logs/${screenshotFile})`);
    } finally {
        await browser.close();
    }
}
