import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Page } from 'puppeteer';
import { requireDzen1002Action } from '../dzen1002_action_restriction';
import type { Dzen1002Claim, Dzen1002Receipt } from '../dzen1002_runtime_contract';
import { parseBrowserCookieHeader } from './dzen_dom_helpers';
import { DZEN1002_ACCOUNT, nativeUncertain } from './dzen1002_publisher_proof';
import { dzen1002PagePorts, runDzen1002NativeSequence, type Dzen1002Hooks } from './dzen1002_publisher_page';

type Phase = 'readonly' | 'editing' | 'submitting';
/** Native request allowlist is phase-scoped. Public article navigation is never part of this adapter. */
export function dzen1002NativeRequest(method: string, input: string, phase: Phase, objectId?: string): boolean {
    let url: URL;
    try { url = new URL(input); } catch { return false; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        if (url.hostname === 'yastatic.net' || url.hostname.endsWith('.yastatic.net')) return true;
        if (url.hostname === 'avatars.dzeninfra.ru') return /^\/get-zen_doc\/[a-zA-Z0-9_/-]+$/.test(url.pathname);
        if (url.origin !== 'https://dzen.ru') return false;
        if (url.searchParams.has('publisherId') && url.searchParams.get('publisherId') !== DZEN1002_ACCOUNT) return false;
        const studio = `/profile/editor/id/${DZEN1002_ACCOUNT}`;
        if (url.pathname === `${studio}/publications`) return true;
        if (phase !== 'readonly' && new RegExp(`^${studio}/[a-zA-Z0-9_-]{1,100}/edit$`).test(url.pathname)) {
            return !objectId || url.pathname === `${studio}/${objectId}/edit`;
        }
        if (url.pathname === `/editor-api/v3/publishers/${DZEN1002_ACCOUNT}` || url.pathname === '/editor-api/v3/publications') return true;
        return Boolean(objectId && url.pathname === `/editor-api/v2/publisher/${DZEN1002_ACCOUNT}/publication/${objectId}`);
    }
    if (url.origin !== 'https://dzen.ru' || phase === 'readonly' || !['POST', 'PUT', 'PATCH'].includes(method)) return false;
    if (url.pathname === '/editor-api/v2/add-image') return phase === 'editing';
    const base = `/editor-api/v2/publisher/${DZEN1002_ACCOUNT}/publication`;
    if (url.pathname === base) return phase === 'editing';
    if (objectId && /^[a-zA-Z0-9_-]{1,100}$/.test(objectId)) {
        if (url.pathname === `${base}/${objectId}/publish`) return phase === 'submitting' && method === 'POST';
        if (url.pathname === `${base}/${objectId}`) return phase === 'editing';
    }
    return false;
}

async function approvedAssetBytes(claim: Dzen1002Claim): Promise<Uint8Array> {
    const url = new URL(claim.package.assetUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !['supabase.co', 'r2.dev'].some(host => url.hostname.endsWith(`.${host}`))) return nativeUncertain();
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body || !/^image\/(?:jpeg|png|webp)(?:;|$)/.test(response.headers.get('content-type') || '')) return nativeUncertain();
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength; if (size > 2_000_000) return nativeUncertain(); parts.push(chunk.value); }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    if (!size || createHash('sha256').update(bytes).digest('hex') !== claim.package.assetSha256) return nativeUncertain();
    return bytes;
}

async function uploadCover(page: Page, file: string): Promise<void> {
    const input = await page.waitForSelector('input[type="file"][accept*="image"]', { timeout: 10_000 });
    if (!input) return nativeUncertain();
    const pending = page.waitForResponse(response => response.url() === 'https://dzen.ru/editor-api/v2/add-image'
        && response.request().method() === 'POST', { timeout: 30_000 }).then(response => response.status(), () => null);
    await input.uploadFile(file);
    if (await pending !== 200) return nativeUncertain();
}

/** Same-process server entry: action guards precede database, decryption, asset and browser access. */
export async function publishDzen1002Native(claim: Dzen1002Claim, hooks: Dzen1002Hooks): Promise<Dzen1002Receipt> {
    requireDzen1002Action('publish');
    requireDzen1002Action('readback');
    try { return await publishDzen1002Server(claim, hooks); } catch { return nativeUncertain(); }
}

async function publishDzen1002Server(claim: Dzen1002Claim, hooks: Dzen1002Hooks): Promise<Dzen1002Receipt> {
    const p = claim.package;
    if (p.projectId !== 10 || p.taskId !== 1002 || p.channelId !== 116 || p.accountId !== DZEN1002_ACCOUNT) return nativeUncertain();
    // Deferred imports keep even module initialisation and decrypted configuration behind action scope.
    const { default: db } = await import('../../db');
    const { resolveEffectiveChannelConfig } = await import('../../utils/channel.utils');
    const { default: puppeteer } = await import('puppeteer');
    const channel = await db.socialChannel.findFirst({ where: { id: 116, project_id: 10, is_active: true } });
    if (!channel || !['dzen', 'zen', 'zen_article'].includes(channel.type)) return nativeUncertain();
    const config: unknown = resolveEffectiveChannelConfig('dzen', channel.config);
    if (!config || typeof config !== 'object' || !('cookies' in config) || typeof config.cookies !== 'string'
        || !('channel_id' in config) || config.channel_id !== p.accountId) return nativeUncertain();
    const cookieText = config.cookies;
    if (cookieText.length > 65_536 || p.body.length > 50_000) return nativeUncertain();
    let cookies;
    try { cookies = ['dzen.ru', '.dzen.ru', '.yandex.ru'].flatMap(domain => parseBrowserCookieHeader(cookieText, domain)); }
    catch { return nativeUncertain(); }
    if (!cookies.length) return nativeUncertain();
    const asset = await approvedAssetBytes(claim);
    const directory = await mkdtemp(join(tmpdir(), 'dzen1002-')); const file = join(directory, 'cover');
    try {
        await writeFile(file, asset, { mode: 0o600 });
        const browser = await puppeteer.launch({ headless: true });
        try {
            const page = await browser.newPage(); page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(30_000);
            await page.setCookie(...cookies); await page.setRequestInterception(true);
            let phase: Phase = 'readonly'; let objectId: string | undefined; let requestFailed = false;
            const deadline = Date.now() + 180_000; let requestCount = 0;
            page.on('request', request => {
                requestCount++;
                if (requestCount > 500 || Date.now() > deadline) {
                    requestFailed = true; void request.abort().catch(() => { requestFailed = true; }); return;
                }
                const candidate = new URL(page.url()).pathname.match(new RegExp(`^/profile/editor/id/${DZEN1002_ACCOUNT}/([a-zA-Z0-9_-]{1,100})/edit$`))?.[1];
                if (candidate && objectId && candidate !== objectId) {
                    requestFailed = true; void request.abort().catch(() => { requestFailed = true; }); return;
                }
                if (candidate) objectId = candidate;
                const operation = dzen1002NativeRequest(request.method(), request.url(), phase, objectId)
                    ? request.continue() : request.abort();
                void operation.catch(() => { requestFailed = true; });
            });
            const guarded: Dzen1002Hooks = {
                beforeMutation: async () => {
                    if (requestFailed || Date.now() > deadline) return nativeUncertain();
                    await hooks.beforeMutation();
                    if (requestFailed || Date.now() > deadline) return nativeUncertain(); phase = 'editing';
                },
                beforeSubmit: async () => {
                    if (requestFailed || Date.now() > deadline) return nativeUncertain();
                    await hooks.beforeSubmit();
                    if (requestFailed || Date.now() > deadline) return nativeUncertain(); phase = 'submitting';
                }
            };
            const receipt = await runDzen1002NativeSequence(claim, guarded, dzen1002PagePorts(page, claim, () => uploadCover(page, file)));
            if (requestFailed) return nativeUncertain(); return receipt;
        } finally { await browser.close(); }
    } catch { return nativeUncertain(); }
    finally { await rm(directory, { recursive: true, force: true }); }
}
