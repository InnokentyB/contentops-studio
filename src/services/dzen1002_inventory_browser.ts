import puppeteer, { TimeoutError, type Page } from 'puppeteer';
import { enumerateDzen1002Inventory, type InventoryPage, type InventoryDiagnostic } from './dzen1002_inventory';
import { parseBrowserCookieHeader, type DzenStudioPublication } from './puppeteer/dzen_dom_helpers';
import puppeteerPublisherService from './puppeteer_publisher.service';
import { Dzen1002ReadFailure, type Dzen1002ObservedResponse } from './dzen1002_read_failure';

const CHANNEL = '6a8029aba055ec36033bf81c';
const LIST = `https://dzen.ru/profile/editor/id/${CHANNEL}/publications`;
const PATH = '/editor-api/v3/publications';
type Dzen1002Readback = { authenticated: boolean; editor_available: boolean; editor_url: string;
    publications_payload_received: boolean; title_readback_complete: boolean; state_readback_complete: boolean;
    publication_timestamp_readback_complete: boolean; coverage_complete: boolean;
    publications: DzenStudioPublication[]; inventory_diagnostics: InventoryDiagnostic[]; checked_at: string };

/** Authentication parity seam: a Studio URL alone is never login/CAPTCHA clearance. */
export async function verifyDzen1002StudioPage(page: Pick<Page, 'url'>, authenticate: () => Promise<void>): Promise<void> {
    await authenticate();
    if (!page.url().startsWith(LIST)) throw new Error('[DZEN1002_INVENTORY_STUDIO_NOT_VERIFIED]');
}

/** Read only task1002's configured Studio; intercept all non-GET/HEAD traffic. */
export async function readDzen1002Inventory(config: { cookies?: string; channel_id?: string }): Promise<Dzen1002Readback> {
    if (!config.cookies?.trim() || config.channel_id !== CHANNEL) throw new Error('[DZEN1002_INVENTORY_SCOPE_MISMATCH]');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage(); const expires = Date.now() + 60_000;
        let interceptionFailed = false; let authenticated = false;
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        const timeout = (maximum = 8_000) => Math.max(1, Math.min(maximum, expires - Date.now()));
        let observed: Dzen1002ObservedResponse[] = [];
        page.on('response', response => {
            if (!URL.canParse(response.url())) return;
            const url = new URL(response.url());
            if (url.origin !== 'https://dzen.ru' || url.pathname !== PATH) return;
            const state = url.searchParams.get('state');
            observed.push({ path: PATH, status: response.status(), state: state === 'published' || state === 'draft' ? state : 'other' });
            if (observed.length > 6) observed.shift();
        });
        await page.setRequestInterception(true);
        page.on('request', request => {
            void (['GET', 'HEAD'].includes(request.method().toUpperCase()) ? request.continue() : request.abort('blockedbyclient'))
                .catch(() => { interceptionFailed = true; }); // Fail the returned proof; cleanup stays in finally.
        });
        await page.setCookie(...['dzen.ru', '.dzen.ru', '.yandex.ru'].flatMap(domain => parseBrowserCookieHeader(config.cookies!, domain)));
        const result = await enumerateDzen1002Inventory({
            first: async state => {
                observed = [];
                const pending = page.waitForResponse(response => {
                    const url = new URL(response.url());
                    return url.origin === 'https://dzen.ru' && url.pathname === PATH && url.searchParams.get('state') === state;
                }, { timeout: timeout(30_000) }).then(response => ({ response, reason: 'REQUEST_FAILED' as const }),
                    (error: unknown) => ({ response: null, reason: error instanceof TimeoutError ? 'RESPONSE_TIMEOUT' as const : 'REQUEST_FAILED' as const }));
                try { await page.goto(`${LIST}?state=${state}`, { waitUntil: 'domcontentloaded', timeout: timeout(30_000) }); }
                catch (error: unknown) { throw new Dzen1002ReadFailure(error instanceof TimeoutError ? 'NAVIGATION_TIMEOUT' : 'REQUEST_FAILED', null, observed); }
                authenticated = false;
                try { await boundedRead(verifyDzen1002StudioPage(page, () => puppeteerPublisherService.assertDzenAuthenticated(page)), timeout()); }
                catch (error: unknown) {
                    if (error instanceof Dzen1002ReadFailure) throw error;
                    const message = error instanceof Error ? error.message : '';
                    throw new Dzen1002ReadFailure(message.includes('CAPTCHA') ? 'CHALLENGE_REQUIRED'
                        : message.includes('authentication failed') ? 'AUTH_REQUIRED' : 'STUDIO_ROUTE_MISMATCH', null, observed);
                }
                authenticated = true;
                const { response, reason } = await pending;
                if (!response) throw new Dzen1002ReadFailure(reason, null, observed);
                const paginationHeaders = Object.fromEntries(['x-total-count', 'x-total', 'x-pagination-total-count', 'content-range', 'link']
                    .map(name => [name, response.headers()[name]]));
                if (response.status() !== 200) return { url: response.url(), status: response.status(), payload: null, paginationHeaders };
                const size = Number(response.headers()['content-length']);
                if (size > 2 * 1024 * 1024) throw new Dzen1002ReadFailure('RESPONSE_TOO_LARGE', response.status(), observed);
                let body: Uint8Array;
                try { body = await boundedRead(response.buffer(), timeout()); }
                catch (error: unknown) { throw new Dzen1002ReadFailure(error instanceof Dzen1002ReadFailure ? error.reason : 'BODY_READ_FAILED', response.status(), observed); }
                if (body.length > 2 * 1024 * 1024) throw new Dzen1002ReadFailure('RESPONSE_TOO_LARGE', response.status(), observed);
                let payload: unknown;
                try { payload = JSON.parse(Buffer.from(body).toString('utf8')); }
                catch { throw new Dzen1002ReadFailure('PAYLOAD_INVALID', response.status(), observed); }
                return { url: response.url(), status: response.status(), payload, paginationHeaders };
            },
            next: url => readNextPage(page, url, timeout())
        });
        if (interceptionFailed) {
            result.complete = false;
            result.diagnostics.push({ state: 'draft', page: 0, status: null, count: 0,
                path: PATH, reason: 'REQUEST_INTERCEPTION_FAILED' });
        }
        const verifiedStudio = page.url().startsWith(LIST);
        return { authenticated: verifiedStudio && authenticated, editor_available: verifiedStudio && authenticated, editor_url: page.url(),
            publications_payload_received: result.diagnostics.some(d => d.status === 200),
            title_readback_complete: result.complete, state_readback_complete: result.complete,
            publication_timestamp_readback_complete: result.publications.every(p => p.state === 'draft' || p.published_at !== null),
            coverage_complete: result.complete, publications: result.publications,
            inventory_diagnostics: result.diagnostics, checked_at: new Date().toISOString() };
    } finally { await browser.close(); }
}

async function readNextPage(page: Page, target: string, timeout: number): Promise<InventoryPage> {
    const parsed = new URL(target);
    if (parsed.origin !== 'https://dzen.ru' || parsed.pathname !== PATH) throw new Error('[DZEN1002_INVENTORY_ROUTE_INVALID]');
    return boundedRead(page.evaluate(async (url, budget) => {
        const response = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(budget) });
        if (response.status !== 200) return { url, status: response.status, payload: null };
        if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('Response limit');
        const text = await response.text();
        if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('Response limit');
        const payload: unknown = JSON.parse(text);
        return { url, status: response.status, payload };
    }, target, timeout), timeout);
}

async function boundedRead<T>(work: Promise<T>, timeout: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Dzen1002ReadFailure('READ_TIMEOUT')), timeout);
    })]); }
    finally { if (timer) clearTimeout(timer); }
}
