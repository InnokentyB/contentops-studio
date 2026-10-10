import puppeteer from 'puppeteer';
import { parseBrowserCookieHeader } from './puppeteer/dzen_dom_helpers';
import { resumeDzen1045InExistingDraft } from './puppeteer/dzen1045_existing_draft';
import type { Dzen1045DraftProof } from './dzen_task1045_resume_contract';

type Config = { cookies: string; channel_id: string };

export async function resumeDzen1045DraftInBrowser(config: Config, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string },
    claim: (proof: Dzen1045DraftProof) => Promise<boolean>) {
    const browser = await puppeteer.launch({ headless: true, args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'
    ] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        const cookies = [
            ...parseBrowserCookieHeader(config.cookies, 'dzen.ru'),
            ...parseBrowserCookieHeader(config.cookies, '.dzen.ru'),
            ...parseBrowserCookieHeader(config.cookies, '.yandex.ru')
        ];
        if (cookies.length === 0) throw new Error('[DZEN_AUTH_REQUIRED] Parsed cookie set is empty');
        await page.setCookie(...cookies);
        return await resumeDzen1045InExistingDraft(page, acceptedBody, args, claim);
    } finally {
        await browser.close();
    }
}
