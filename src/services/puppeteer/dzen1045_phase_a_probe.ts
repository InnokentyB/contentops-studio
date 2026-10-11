import type { Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { isDzenProbeWriteMethod } from '../dzen_task1045_phase_a_probe_contract';
import { DZEN_EDITOR_SELECTORS } from './dzen_dom_helpers';

/** Strict read-only Studio probe: mutation methods are aborted before leaving Chromium. */
export async function probeDzen1045CreationContract(page: Page) {
    const blockedWrites: Array<{ method: string; path: string }> = [];
    const reads: Array<{ method: string; path: string; status?: number }> = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
        const method = request.method().toUpperCase();
        let url: URL; try { url = new URL(request.url()); } catch { void request.continue(); return; }
        const owned = url.hostname === 'dzen.ru' || url.hostname.endsWith('.dzen.ru');
        if (owned && isDzenProbeWriteMethod(method)) {
            blockedWrites.push({ method, path: url.pathname }); void request.abort(); return;
        }
        if (owned && method === 'GET' && reads.length < 50) reads.push({ method, path: url.pathname });
        void request.continue();
    });
    page.on('response', response => {
        try { const url = new URL(response.url());
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
    const dom = await page.evaluate((addSelector) => {
        const visible = (element: Element) => { const node = element as HTMLElement; const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0; };
        const descriptor = (element: Element) => ({ tag: element.tagName.toLowerCase(),
            text: ((element as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            role: element.getAttribute('role'), ariaLabel: element.getAttribute('aria-label'),
            ariaHasPopup: element.getAttribute('aria-haspopup'), ariaControls: element.getAttribute('aria-controls'),
            dataTestId: element.getAttribute('data-testid'), href: element instanceof HTMLAnchorElement ? element.href : null,
            disabled: element instanceof HTMLButtonElement ? element.disabled : element.getAttribute('aria-disabled') === 'true',
            visible: visible(element) });
        const add = document.querySelector(addSelector);
        const creationCandidates = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
            .filter(element => /созд|напис|публикац|create|write|new/i.test(`${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('data-testid') || ''}`))
            .map(descriptor).slice(0, 30);
        return { documentReadyState: document.readyState, title: document.title,
            addPublication: add ? descriptor(add) : null, creationCandidates,
            editorLinks: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/edit"]'))
                .map(link => ({ text: link.innerText.trim().slice(0, 100), href: link.href })).slice(0, 30) };
    }, DZEN_EDITOR_SELECTORS.addPublication);
    return { authenticated: !/login|passport\.yandex/i.test(page.url()), currentUrl: page.url(),
        studioUrl, readOnlyEnforced: true, clickedControls: 0, blockedWrites, reads, dom,
        inference: dom.addPublication?.href
            ? 'creation_affordance_is_navigation_link'
            : 'creation_affordance_is_scripted_control_without_readable_editor_route',
        checkedAt: new Date().toISOString() };
}
