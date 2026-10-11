import puppeteer from 'puppeteer';
import { parseBrowserCookieHeader } from './puppeteer/dzen_dom_helpers';
import { inspectDzen1045Absence, resumeDzen1045InExistingDraft } from './puppeteer/dzen1045_existing_draft';
import type { Dzen1045DraftProof } from './dzen_task1045_resume_contract';
import { recoverDzen1045SecondAttemptInBrowser } from './puppeteer/dzen1045_second_attempt';
import type { Dzen1045SecondAttemptDraftProof } from './dzen_task1045_second_attempt_contract';

type Config = { cookies: string; channel_id: string };

async function withDzen1045Page<T>(config: Config, run: (page: import('puppeteer').Page) => Promise<T>) {
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
        return await run(page);
    } finally {
        await browser.close();
    }
}

export async function inspectDzen1045AbsenceInBrowser(config: Config) {
    return withDzen1045Page(config, inspectDzen1045Absence);
}

export async function resumeDzen1045DraftInBrowser(config: Config, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string },
    claim: (proof: Dzen1045DraftProof) => Promise<boolean>) {
    return withDzen1045Page(config, page => resumeDzen1045InExistingDraft(page, acceptedBody, args, claim));
}

export async function recoverDzen1045SecondAttemptInBrowserSession(config: Config, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string },
    claim: (proof: Dzen1045SecondAttemptDraftProof) => Promise<boolean>) {
    return withDzen1045Page(config,
        page => recoverDzen1045SecondAttemptInBrowser(page, acceptedBody, args, claim));
}
