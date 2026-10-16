import { createHash } from 'crypto';
import type { ElementHandle, HTTPResponse, Page } from 'puppeteer';
import type { Dzen1002Claim, Dzen1002Receipt } from '../dzen1002_runtime_contract';
import { DZEN_EDITOR_SELECTORS as selectors } from './dzen_dom_helpers';
import { DZEN1002_ACCOUNT, dzen1002CoverUrl, nativeUncertain, normalizeDzen1002Body,
    verifyDzen1002NativeProof, type Dzen1002Primary } from './dzen1002_publisher_proof';

export type Dzen1002Hooks = { beforeMutation: () => Promise<void>; beforeSubmit: () => Promise<void> };
export interface Dzen1002NativePorts {
    identity(): Promise<void>;
    compose(): Promise<string>;
    readPrimary(objectId: string): Promise<Dzen1002Primary>;
    readCover(primary: Dzen1002Primary): Promise<Uint8Array>;
    openDialog(): Promise<void>;
    submit(objectId: string): Promise<unknown>;
    readStudio(objectId: string): Promise<unknown>;
    now(): string;
}
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function preSubmit(claim: Dzen1002Claim, objectId: string, primary: Dzen1002Primary, cover: Uint8Array): void {
    const p = claim.package;
    if (primary.objectId !== objectId || primary.accountId !== p.accountId || primary.accountId !== DZEN1002_ACCOUNT
        || primary.title !== p.title || typeof primary.body !== 'string'
        || normalizeDzen1002Body(primary.body) !== normalizeDzen1002Body(p.body)
        || sha(cover) !== p.assetSha256) return nativeUncertain();
    dzen1002CoverUrl(primary);
}
/** Internal transport orchestration. Only production entry owns session lookup and action guards. */
export async function runDzen1002NativeSequence(claim: Dzen1002Claim, hooks: Dzen1002Hooks,
    ports: Dzen1002NativePorts): Promise<Dzen1002Receipt> {
    await ports.identity();
    await hooks.beforeMutation();
    const objectId = await ports.compose();
    const first = await ports.readPrimary(objectId);
    preSubmit(claim, objectId, first, await ports.readCover(first));
    await ports.openDialog();
    const final = await ports.readPrimary(objectId);
    preSubmit(claim, objectId, final, await ports.readCover(final));
    await hooks.beforeSubmit();
    const submit = await ports.submit(objectId);
    const studio = await ports.readStudio(objectId);
    const primary = await ports.readPrimary(objectId);
    const coverBytes = await ports.readCover(primary);
    return verifyDzen1002NativeProof(claim, { schemaVersion: 'studio-v3-editor-v2', submit, studio, primary,
        coverBytes, observedAt: ports.now() });
}

/** Browser-side GET with bounded streaming; redirects and non-200 responses never supply evidence. */
export async function boundedDzen1002Read(page: Page, url: string, binary = false): Promise<unknown> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
        || !['dzen.ru', 'avatars.dzeninfra.ru'].includes(parsed.hostname)) return nativeUncertain();
    const result = await page.evaluate(async input => {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(input.url, { method: 'GET', credentials: 'same-origin', redirect: 'error', signal: controller.signal });
            if (response.status !== 200 || !response.body) return null;
            const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
            try {
                while (true) { const chunk = await reader.read(); if (chunk.done) break;
                    length += chunk.value.byteLength; if (length > 2_000_000) return null; parts.push(chunk.value); }
            } finally { await reader.cancel(); }
            const bytes = new Uint8Array(length); let offset = 0;
            for (const part of parts) { bytes.set(part, offset); offset += part.length; }
            return input.binary ? Array.from(bytes) : new TextDecoder().decode(bytes);
        } finally { clearTimeout(timer); }
    }, { url, binary });
    if (result === null) return nativeUncertain();
    if (binary && Array.isArray(result)) return Uint8Array.from(result);
    if (typeof result !== 'string') return nativeUncertain();
    try { return JSON.parse(result) as unknown; } catch { return nativeUncertain(); }
}

/** Extract only the exact authenticated v2 object and its own editor primary body. */
export async function readDzen1002Primary(page: Page, objectId: string): Promise<Dzen1002Primary> {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(objectId)) return nativeUncertain();
    const payload = record(await boundedDzen1002Read(page,
        `https://dzen.ru/editor-api/v2/publisher/${DZEN1002_ACCOUNT}/publication/${objectId}`));
    const items = payload.publications;
    if (!Array.isArray(items) || items.length !== 1) return nativeUncertain();
    const row = record(items[0]); const image = record(record(record(row.content).preview).image);
    const sizes = record(image.sizes); const original = record(sizes.orig);
    if (row.id !== objectId || row.publisherId !== DZEN1002_ACCOUNT || typeof image.id !== 'string'
        || typeof original.url !== 'string') return nativeUncertain();
    const expectedPath = `/profile/editor/id/${DZEN1002_ACCOUNT}/${objectId}/edit`;
    if (new URL(page.url()).pathname !== expectedPath) {
        await page.goto(`https://dzen.ru${expectedPath}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (new URL(page.url()).pathname !== expectedPath) return nativeUncertain();
    }
    const primary = await page.evaluate(input => {
        const titles = document.querySelectorAll<HTMLElement>(input.title);
        const bodies = document.querySelectorAll<HTMLElement>(input.body);
        if (titles.length !== 1 || bodies.length !== 1) return null;
        return { title: titles[0].innerText, body: bodies[0].innerText };
    }, { title: selectors.articleTitle, body: selectors.articleBody });
    if (!primary) return nativeUncertain();
    return { objectId, accountId: DZEN1002_ACCOUNT, ...primary,
        cover: { objectId, imageId: image.id, url: original.url } };
}

/** The bounded response shape allowlist deliberately excludes arbitrary nested URLs. */
async function submitIdentity(response: HTTPResponse): Promise<unknown> {
    const headers = response.headers(); const declared = Number(headers['content-length']);
    if (response.status() !== 200 || (headers['content-encoding'] && headers['content-encoding'] !== 'identity')
        || !Number.isSafeInteger(declared) || declared < 1 || declared > 2_000_000) return nativeUncertain();
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > declared) return nativeUncertain();
    let payload: unknown;
    try { payload = JSON.parse(text) as unknown; } catch { return nativeUncertain(); }
    const root = record(payload); const row = record(root.publication);
    if (typeof row.id !== 'string' || typeof row.publisherId !== 'string') return nativeUncertain();
    return { id: row.id, publisherId: row.publisherId };
}

function validFinalControl(node: Element): boolean {
    const ready = (element: Element): boolean => element instanceof HTMLButtonElement && element.isConnected
        && /^(?:опубликовать|publish)$/i.test(element.innerText.trim())
        && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
        && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none'
        && !element.disabled && element.getAttribute('aria-disabled') !== 'true'
        && Boolean(element.closest('[role="dialog"], [aria-modal="true"]'));
    const candidates = Array.from(document.querySelectorAll('[data-testid="publish-btn"]')).filter(ready);
    return ready(node) && candidates.length === 1 && candidates[0] === node;
}

/** Construct real Puppeteer operations from fixed routes; no selector, script or endpoint input is accepted. */
export function dzen1002PagePorts(page: Page, claim: Dzen1002Claim,
    uploadCover: () => Promise<void>): Dzen1002NativePorts {
    let finalControl: ElementHandle<Element> | null = null;
    const account = DZEN1002_ACCOUNT; const list = `https://dzen.ru/profile/editor/id/${account}/publications`;
    return {
        identity: async () => {
            await page.goto(list, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            if (new URL(page.url()).pathname !== new URL(list).pathname) return nativeUncertain();
            const payload = record(await boundedDzen1002Read(page, `https://dzen.ru/editor-api/v3/publishers/${account}`));
            if (record(payload.publisher).id !== account || record(payload.accessData).canWrite !== true) return nativeUncertain();
        },
        compose: async () => {
            await page.waitForSelector(selectors.addPublication, { visible: true, timeout: 15_000 });
            await page.click(selectors.addPublication);
            await page.waitForSelector(selectors.articleMenuItem, { visible: true, timeout: 10_000 });
            await page.click(selectors.articleMenuItem);
            await page.waitForFunction(() => /\/profile\/editor\/id\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/edit$/.test(location.pathname), { timeout: 15_000 });
            const objectId = new URL(page.url()).pathname.match(new RegExp(`^/profile/editor/id/${account}/([a-zA-Z0-9_-]{1,100})/edit$`))?.[1];
            if (!objectId) return nativeUncertain();
            for (const [selector, value] of [[selectors.articleTitle, claim.package.title], [selectors.articleBody, claim.package.body]]) {
                const element = await page.waitForSelector(selector, { visible: true, timeout: 15_000 });
                if (!element || await element.evaluate(node => (node as HTMLElement).innerText !== '')) return nativeUncertain();
                await element.type(value, { delay: 1 });
            }
            await uploadCover(); return objectId;
        },
        readPrimary: objectId => readDzen1002Primary(page, objectId),
        readCover: async primary => {
            const bytes = await boundedDzen1002Read(page, dzen1002CoverUrl(primary), true);
            if (!(bytes instanceof Uint8Array)) return nativeUncertain(); return bytes;
        },
        openDialog: async () => {
            await page.click(selectors.articlePublish);
            await page.waitForSelector(selectors.publicationConfirm, { visible: true, timeout: 15_000 });
            const candidates = await page.$$(selectors.publicationConfirm);
            const matches: ElementHandle<Element>[] = [];
            for (const candidate of candidates) if (await candidate.evaluate(validFinalControl)) matches.push(candidate);
            if (matches.length !== 1) return nativeUncertain();
            finalControl = matches[0];
        },
        submit: async objectId => {
            if (!finalControl || !(await finalControl.evaluate(validFinalControl))) return nativeUncertain();
            const endpoint = `/editor-api/v2/publisher/${account}/publication/${objectId}/publish`;
            // Install waiter before the trusted click; consume rejection even if click fails.
            const pending = page.waitForResponse(response => new URL(response.url()).origin === 'https://dzen.ru'
                && new URL(response.url()).pathname === endpoint && response.request().method() === 'POST',
            { timeout: 30_000 }).then(response => submitIdentity(response)).catch(() => null);
            await finalControl.click();
            const result = await pending; if (!result) return nativeUncertain(); return result;
        },
        readStudio: async objectId => {
            const payload = record(await boundedDzen1002Read(page,
                `https://dzen.ru/editor-api/v3/publications?publisherId=${account}&state=published&page=1&pageSize=100`));
            if (!Array.isArray(payload.publications) || payload.publications.length > 100) return nativeUncertain();
            const matches = payload.publications.map(record).filter(row => row.id === objectId);
            if (matches.length !== 1) return nativeUncertain();
            const row = matches[0];
            return { id: row.id, publisherId: row.publisherId, title: row.title, isPublished: row.isPublished,
                status: row.status, publishTime: row.publishTime, commonUrl: row.commonUrl };
        },
        now: () => new Date().toISOString()
    };
}
