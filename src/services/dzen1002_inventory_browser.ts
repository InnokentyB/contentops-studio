import puppeteer, { type Page } from 'puppeteer';
import { enumerateDzen1002Inventory, type InventoryPage, type InventoryDiagnostic } from './dzen1002_inventory';
import { parseBrowserCookieHeader, type DzenStudioPublication } from './puppeteer/dzen_dom_helpers';

const CHANNEL = '6a8029aba055ec36033bf81c';
const LIST = `https://dzen.ru/profile/editor/id/${CHANNEL}/publications`;
const PATH = '/editor-api/v3/publications';
type Dzen1002Readback = { authenticated: boolean; editor_available: boolean; editor_url: string;
    publications_payload_received: boolean; title_readback_complete: boolean; state_readback_complete: boolean;
    publication_timestamp_readback_complete: boolean; coverage_complete: boolean;
    publications: DzenStudioPublication[]; inventory_diagnostics: InventoryDiagnostic[]; checked_at: string };

/** Read only task1002's configured Studio; intercept all non-GET/HEAD traffic. */
export async function readDzen1002Inventory(config: { cookies?: string; channel_id?: string }): Promise<Dzen1002Readback> {
    if (!config.cookies?.trim() || config.channel_id !== CHANNEL) throw new Error('[DZEN1002_INVENTORY_SCOPE_MISMATCH]');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage(); const expires = Date.now() + 60_000;
        let interceptionFailed = false;
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        const timeout = () => Math.max(1, Math.min(8_000, expires - Date.now()));
        await page.setRequestInterception(true);
        page.on('request', request => {
            void (['GET', 'HEAD'].includes(request.method().toUpperCase()) ? request.continue() : request.abort('blockedbyclient'))
                .catch(() => { interceptionFailed = true; }); // Fail the returned proof; cleanup stays in finally.
        });
        await page.setCookie(...['dzen.ru', '.dzen.ru', '.yandex.ru'].flatMap(domain => parseBrowserCookieHeader(config.cookies!, domain)));
        const result = await enumerateDzen1002Inventory({
            first: async state => {
                const pending = page.waitForResponse(response => {
                    const url = new URL(response.url());
                    return url.origin === 'https://dzen.ru' && url.pathname === PATH && url.searchParams.get('state') === state;
                }, { timeout: timeout() }).then(response => ({ response }), () => ({ response: null }));
                await page.goto(`${LIST}?state=${state}`, { waitUntil: 'domcontentloaded', timeout: timeout() });
                const { response } = await pending;
                if (!response) throw new Error('[DZEN1002_INVENTORY_RESPONSE_MISSING]');
                if (!page.url().startsWith(LIST)) throw new Error('[DZEN1002_INVENTORY_STUDIO_NOT_VERIFIED]');
                if (response.status() !== 200) return { url: response.url(), status: response.status(), payload: null };
                const size = Number(response.headers()['content-length']);
                if (size > 2 * 1024 * 1024) throw new Error('[DZEN1002_INVENTORY_RESPONSE_LIMIT]');
                const body = await boundedRead(response.buffer(), timeout());
                if (body.length > 2 * 1024 * 1024) throw new Error('[DZEN1002_INVENTORY_RESPONSE_LIMIT]');
                const payload: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
                return { url: response.url(), status: response.status(), payload };
            },
            next: url => readNextPage(page, url, timeout())
        });
        if (interceptionFailed) {
            result.complete = false;
            result.diagnostics.push({ state: 'draft', page: 0, status: null, count: 0,
                path: PATH, reason: 'REQUEST_INTERCEPTION_FAILED' });
        }
        const verifiedStudio = page.url().startsWith(LIST);
        return { authenticated: verifiedStudio, editor_available: verifiedStudio, editor_url: page.url(),
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
        timer = setTimeout(() => reject(new Error('[DZEN1002_INVENTORY_READ_TIMEOUT]')), timeout);
    })]); }
    finally { if (timer) clearTimeout(timer); }
}
