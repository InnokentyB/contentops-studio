import puppeteer, { type Page } from 'puppeteer';
import { parseBrowserCookieHeader } from './dzen_dom_helpers';
import { canonicalPublicDzenUrl } from './dzen_publication_outcome';
import type { DzenConfig } from '../dzen.service';

/** Accept only canonical public Dzen publications; reject credentials, protocols and hidden URL state. */
export function dzenReadUrl(input: string): string {
    const url = new URL(input);
    const canonical = canonicalPublicDzenUrl(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !canonical) throw new Error('DZEN_READ_URL_INVALID');
    return canonical;
}

/** Derive the configured publisher identity without trusting a caller-supplied channel or endpoint. */
export function dzenPublisherId(config: DzenConfig): string {
    const candidate = config.channel_id?.trim() || config.channel_url?.trim() || '';
    if (/^[a-zA-Z0-9_-]{1,100}$/.test(candidate)) return candidate;
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['dzen.ru','www.dzen.ru'].includes(url.hostname)) throw new Error('DZEN_AUTH_REQUIRED');
    const id = url.pathname.match(/^\/(?:id|profile\/editor\/id)\/([a-zA-Z0-9_-]{1,100})(?:\/|$)/)?.[1];
    if (!id) throw new Error('DZEN_AUTH_REQUIRED');
    return id;
}

/** Enforce read-only native traffic, including GET APIs with mutation flags. */
export function dzenReadonlyRequest(method: string, input: string): string | null {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!['dzen.ru','dzeninfra.ru','yastatic.net','yandex.net','yandex.ru','ya.ru'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    if (!['GET','HEAD','OPTIONS'].includes(method)) return null;
    if (/^\/(?:api|editor-api|media-api)\//.test(url.pathname) && /(?:^|\/)(?:seen-until|read|mark-read|mark-viewed|delete|remove|add|subscribe|unsubscribe|like|dislike|update)(?:\/|$)/i.test(url.pathname)) return null;
    if (url.pathname === '/api/comments/v2/root-comments') url.searchParams.set('updateDefaultSorting', 'false');
    return url.toString();
}

const readHeaders = new WeakMap<Page, Record<string,string>>();

/** Fetch only same-origin native JSON using fixed reader endpoints and an explicit timeout. */
export async function dzenNativeJson(page: Page, pathname: string, query: Record<string, string> = {}): Promise<unknown> {
    if (!/^\/(?:api|editor-api)\/[a-zA-Z0-9/_-]+$/.test(pathname)) throw new Error('DZEN_READ_URL_INVALID');
    const url = new URL(pathname, 'https://dzen.ru');
    Object.entries(query).forEach(([key,value]) => url.searchParams.set(key,value));
    const result = await page.evaluate(async input => {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 15_000);
        try {
            const response = await fetch(input.url, { method: 'GET', credentials: 'same-origin', headers: input.headers, signal: abort.signal });
            return { status: response.status, payload: response.ok ? await response.json() : null };
        } finally { clearTimeout(timer); }
    }, { url: url.toString(), headers: readHeaders.get(page) ?? {} });
    if ([401,403].includes(result.status)) throw new Error('DZEN_AUTH_REQUIRED');
    if (result.status !== 200) throw new Error('DZEN_INBOUND_INTERFACE_CHANGED');
    return result.payload;
}

/** Run an isolated cookie-backed reader; every browser request is constrained and every browser is closed. */
export async function withDzenReadonlyPage<T>(config: DzenConfig, read: (page: Page, publisherId: string, ownerUid: string) => Promise<T>): Promise<T> {
    const publisherId = dzenPublisherId(config);
    if (!config.cookies?.trim()) throw new Error('DZEN_AUTH_REQUIRED');
    const cookies = ['dzen.ru','.dzen.ru','.yandex.ru'].flatMap(domain => parseBrowserCookieHeader(config.cookies || '',domain));
    if (!cookies.length) throw new Error('DZEN_AUTH_REQUIRED');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', request => {
            const safeUrl = dzenReadonlyRequest(request.method(), request.url());
            const operation = safeUrl ? request.continue({ url: safeUrl }) : request.abort();
            void operation.catch(() => { console.warn('[Dzen read] Intercepted request did not complete; browser cleanup remains mandatory.'); });
        });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setCookie(...cookies);
        const pendingHeaders = page.waitForRequest(request => {
            const native = new URL(request.url());
            return native.origin === 'https://dzen.ru' && request.method() === 'GET' &&
                native.pathname === '/editor-api/v2/social/editor/comments/latest_by_child' && native.searchParams.get('publisherId') === publisherId;
        }, { timeout: 25_000 }).then(request => request.headers(), () => null);
        await page.goto(`https://dzen.ru/profile/editor/id/${publisherId}/comments/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const text = await page.evaluate(() => document.body.innerText.slice(0,1500));
        if (/captcha|капч|подтвердите.*(?:человек|робот)/i.test(text)) throw new Error('Dzen requires a CAPTCHA or interactive account verification');
        if (new URL(page.url()).pathname !== `/profile/editor/id/${publisherId}/comments/`) throw new Error('DZEN_AUTH_REQUIRED');
        const identity = await dzenNativeJson(page, `/editor-api/v3/publishers/${publisherId}`);
        if (!identity || typeof identity !== 'object') throw new Error('DZEN_AUTH_REQUIRED');
        const publisher = Reflect.get(identity,'publisher');
        const access = Reflect.get(identity,'accessData');
        if (!publisher || typeof publisher !== 'object' || Reflect.get(publisher,'id') !== publisherId ||
            !access || typeof access !== 'object' || Reflect.get(access,'canRead') !== true) throw new Error('DZEN_AUTH_REQUIRED');
        const ownerUid: unknown = Reflect.get(publisher,'ownerUid');
        if (typeof ownerUid !== 'number' || !Number.isSafeInteger(ownerUid) || ownerUid < 1) throw new Error('DZEN_AUTH_REQUIRED');
        const observedHeaders = await pendingHeaders;
        const headers: Record<string,string> = {};
        for (const name of ['x-csrf-token','x-fp-token']) {
            const value = observedHeaders?.[name];
            if (value && !/[\r\n\u0000]/.test(value)) headers[name] = value;
        }
        readHeaders.set(page, headers);
        try { return await read(page, publisherId, String(ownerUid)); }
        finally { readHeaders.delete(page); }

    } finally { await browser.close(); }
}
