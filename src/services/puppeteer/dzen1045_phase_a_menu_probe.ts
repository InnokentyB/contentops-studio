import type { Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { isDzenProbeWriteMethod } from '../dzen_task1045_phase_a_probe_contract';
import { DZEN_EDITOR_SELECTORS } from './dzen_dom_helpers';

export async function discoverDzen1045CreationMenu(page: Page, addSelector: string) {
    await page.click(addSelector);
    try {
        await page.waitForFunction(() => {
            const nodes = Array.from(document.querySelectorAll(
                '[role="menu"], [role="dialog"], [role="listbox"], [role="menuitem"], [role="option"]'
            ));
            return nodes.some(element => {
                const node = element as HTMLElement;
                const style = getComputedStyle(node);
                return style.display !== 'none' && style.visibility !== 'hidden'
                    && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
            });
        }, { timeout: 3_000 });
    } catch { /* absence of ARIA roots is itself diagnostic evidence */ }

    const dom = await page.evaluate(() => {
        const visible = (element: Element) => {
            const node = element as HTMLElement;
            const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
        };
        const descriptor = (element: Element) => ({
            tag: element.tagName.toLowerCase(),
            text: ((element as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
            role: element.getAttribute('role'),
            ariaLabel: element.getAttribute('aria-label'),
            ariaHasPopup: element.getAttribute('aria-haspopup'),
            ariaControls: element.getAttribute('aria-controls'),
            dataTestId: element.getAttribute('data-testid'),
            href: element instanceof HTMLAnchorElement ? element.href : null,
            disabled: element instanceof HTMLButtonElement
                ? element.disabled : element.getAttribute('aria-disabled') === 'true'
        });
        const rootSelector = '[role="menu"], [role="dialog"], [role="listbox"], [data-testid*="menu"], [data-testid*="dialog"]';
        const optionSelector = 'button, a[href], [role="menuitem"], [role="option"], [role="button"]';
        const dialogs = Array.from(document.querySelectorAll(rootSelector))
            .filter(visible).map(descriptor).slice(0, 20);
        const options = Array.from(document.querySelectorAll(optionSelector))
            .filter(element => visible(element)
                && /стать|пост|публик|видео|article|post|publication|video/i.test(
                    `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('data-testid') || ''}`
                ))
            .map(descriptor).slice(0, 30);
        return { dialogs, options };
    });
    return { clicked_controls: 1 as const, selected_content_type: null, ...dom };
}

/** One-click UI discovery with a browser-enforced zero-write boundary. */
export async function probeDzen1045CreationMenu(page: Page) {
    const blockedWrites: Array<{ method: string; host: string; path: string; stage: string }> = [];
    const reads: Array<{ method: string; path: string; status?: number }> = [];
    let stage = 'navigation';
    await page.setRequestInterception(true);
    page.on('request', request => {
        const method = request.method().toUpperCase();
        let url: URL; try { url = new URL(request.url()); } catch { void request.continue(); return; }
        if (isDzenProbeWriteMethod(method)) {
            if (blockedWrites.length < 100) blockedWrites.push({ method, host: url.hostname, path: url.pathname, stage });
            void request.abort(); return;
        }
        const owned = url.hostname === 'dzen.ru' || url.hostname.endsWith('.dzen.ru');
        if (owned && method === 'GET' && reads.length < 50) reads.push({ method, path: url.pathname });
        void request.continue();
    });
    page.on('response', response => {
        try {
            const url = new URL(response.url());
            for (let index = reads.length - 1; index >= 0; index -= 1) {
                if (reads[index].path === url.pathname && reads[index].status === undefined) {
                    reads[index].status = response.status(); break;
                }
            }
        } catch { /* bounded diagnostic only */ }
    });
    const studioUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    await page.goto(studioUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    await page.waitForSelector(DZEN_EDITOR_SELECTORS.addPublication, { visible: true, timeout: 15_000 });
    const beforeClickUrl = page.url();
    stage = 'menu_click';
    const menu = await discoverDzen1045CreationMenu(page, DZEN_EDITOR_SELECTORS.addPublication);
    return {
        authenticated: !/login|passport\.yandex/i.test(page.url()),
        studioUrl,
        beforeClickUrl,
        currentUrl: page.url(),
        readOnlyEnforced: true,
        blockedMutationMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
        ...menu,
        blockedWrites,
        reads,
        checkedAt: new Date().toISOString()
    };
}
