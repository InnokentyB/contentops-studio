import type { ElementHandle, Page } from 'puppeteer';
import { DZEN1045_PHASE_B } from '../dzen_task1045_phase_b_contract';
import { dzen1045PackageMatches, readDzen1045EditorPackage } from './dzen1045_second_attempt';
import { isDzen1045ReconcileWriteMethod } from './dzen1045_phase_a_v2_reconcile';

export function isKnownDzenArticleHelp(text: string): boolean {
    return /^Статья.+это в первую очередь текст/i.test(text.trim());
}
export function isSafeDzenOverflowControl(value: { label: string; ariaHasPopup: string | null }): boolean {
    return value.ariaHasPopup === 'menu' || /^(?:ещё|еще|more|menu|меню)$/i.test(value.label.trim());
}
async function capture(page: Page) {
    return page.evaluate(() => { const visible = (element: Element) => { const node = element as HTMLElement;
        const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; };
    return Array.from(document.querySelectorAll('button, [role="button"], a[href], input, select, textarea, [tabindex]'))
        .filter(visible).map(element => { const node = element as HTMLElement; const rect = node.getBoundingClientRect();
            const ancestor = element.closest('header, nav, [role="toolbar"], [role="dialog"], [role="menu"], [class*="toolbar"], [class*="header"]');
            return { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
                text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
                ariaLabel: element.getAttribute('aria-label'), ariaHasPopup: element.getAttribute('aria-haspopup'),
                dataTestId: element.getAttribute('data-testid'), title: element.getAttribute('title'),
                disabled: element instanceof HTMLButtonElement || element instanceof HTMLInputElement
                    ? element.disabled : element.getAttribute('aria-disabled') === 'true',
                geometry: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
                ancestorText: ((ancestor as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500) }; })
        .slice(0, 200); });
}

/** Bounded, zero-provider-write control map. It never selects a publication action. */
export async function probeDzen1045EditorControlMap(page: Page, acceptedBody: string) {
    const blockedWrites: Array<{ method: string; host: string; path: string }> = [];
    await page.setRequestInterception(true);
    page.on('request', request => { const method = request.method().toUpperCase();
        let url: URL; try { url = new URL(request.url()); } catch { void request.continue(); return; }
        if (isDzen1045ReconcileWriteMethod(method)) { blockedWrites.push({ method, host: url.hostname, path: url.pathname });
            void request.abort(); return; } void request.continue(); });
    const observed = await readDzen1045EditorPackage(page, DZEN1045_PHASE_B.providerId, acceptedBody);
    if (!dzen1045PackageMatches(observed)) throw new Error('[DZEN1045_CONTROL_MAP_EXACT_DRAFT_REQUIRED]');
    const before = await capture(page); let helpOpenClicks = 0; let helpCloseClicks = 0;
    const helpButton = await page.$(DZEN1045_PHASE_B.finalSelector);
    if (helpButton) { await helpButton.click(); helpOpenClicks = 1; }
    const helpDialog = await page.waitForFunction(() => Array.from(document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [class*="drawer"], [class*="modal"]'
    )).find(element => ((element as HTMLElement).innerText || '').trim().startsWith('Статья — это в первую очередь текст')), { timeout: 5_000 })
        .catch(() => null);
    const helpControls = helpDialog ? await capture(page) : [];
    if (helpDialog) {
        const closes = await page.$$('[aria-label="Закрыть"]');
        if (closes.length !== 1) throw new Error('[DZEN1045_CONTROL_MAP_HELP_CLOSE_NOT_EXACT]');
        await closes[0].click(); helpCloseClicks = 1;
    }
    const underlying = await capture(page);
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
    const handles = await page.$$('button, [role="button"]');
    const safe: Array<ElementHandle<Element>> = [];
    for (const handle of handles) { const state = await handle.evaluate(element => { const node = element as HTMLElement;
        const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return {
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            disabled: element instanceof HTMLButtonElement ? element.disabled : element.getAttribute('aria-disabled') === 'true',
            label: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
            ariaHasPopup: element.getAttribute('aria-haspopup') }; });
        if (state.visible && !state.disabled && isSafeDzenOverflowControl(state)) safe.push(handle);
    }
    const overflowMenus = [];
    for (const handle of safe.slice(0, 3)) {
        await handle.click(); await new Promise(resolve => setTimeout(resolve, 200));
        overflowMenus.push(await capture(page)); await page.keyboard.press('Escape');
    }
    return { providerId: DZEN1045_PHASE_B.providerId, exactPackage: true, currentUrl: page.url(),
        beforeAnyClick: before, help: { opened: Boolean(helpDialog), controls: helpControls,
            helpOpenClicks, helpCloseClicks }, underlyingEditorControls: underlying,
        safeOverflowOpenClicks: Math.min(safe.length, 3), overflowMenus,
        screenshot: { mimeType: 'image/png', base64: screenshot },
        finalConfirmationClicks: 0, providerWrites: 0, blockedWrites, checkedAt: new Date().toISOString() };
}
