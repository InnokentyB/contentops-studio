import type { Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { DZEN1045_PHASE_B } from '../dzen_task1045_phase_b_contract';
import { dzen1045PackageMatches, readDzen1045EditorPackage } from './dzen1045_second_attempt';
import { isDzen1045ReconcileWriteMethod } from './dzen1045_phase_a_v2_reconcile';

export function isDzen1045FinalDialogControl(label: string): boolean {
    return /^(?:опубликовать|publish)$/i.test(label.replace(/\s+/g, ' ').trim());
}

/** Opens only the known header dialog; all provider mutations remain browser-aborted. */
export async function probeDzen1045PhaseBDialog(page: Page, acceptedBody: string) {
    const blockedWrites: Array<{ method: string; host: string; path: string }> = [];
    await page.setRequestInterception(true);
    page.on('request', request => { const method = request.method().toUpperCase();
        let url: URL; try { url = new URL(request.url()); } catch { void request.continue(); return; }
        if (isDzen1045ReconcileWriteMethod(method)) { blockedWrites.push({ method, host: url.hostname, path: url.pathname });
            void request.abort(); return; }
        void request.continue(); });
    const observed = await readDzen1045EditorPackage(page, DZEN1045_PHASE_B.providerId, acceptedBody);
    if (!dzen1045PackageMatches(observed)) throw new Error('[DZEN1045_PHASE_B_DIALOG_EXACT_DRAFT_REQUIRED]');
    const headers = await page.$$(DZEN1045_PHASE_B.finalSelector);
    const enabled = [];
    for (const control of headers) {
        const state = await control.evaluate(element => { const node = element as HTMLElement;
            const style = getComputedStyle(node); return { visible: style.display !== 'none' && style.visibility !== 'hidden'
                && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
            disabled: element instanceof HTMLButtonElement ? element.disabled : element.getAttribute('aria-disabled') === 'true',
            label: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() }; });
        if (state.visible && !state.disabled && isDzen1045FinalDialogControl(state.label)) enabled.push(control);
    }
    if (enabled.length !== 1) throw new Error('[DZEN1045_PHASE_B_DIALOG_HEADER_NOT_EXACT]');
    await enabled[0].click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [class*="drawer"], [class*="modal"]'
    )).some(element => { const node = element as HTMLElement; const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden'
            && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0; }), { timeout: 10_000 });
    const dom = await page.evaluate(() => {
        const visible = (element: Element) => { const node = element as HTMLElement; const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0; };
        const roots = Array.from(document.querySelectorAll(
            '[role="dialog"], [aria-modal="true"], [class*="drawer"], [class*="modal"]')).filter(visible);
        const controls = roots.flatMap(root => Array.from(root.querySelectorAll(
            'button, [role="button"], input, select, textarea, [role="checkbox"], [role="radio"]')))
            .filter(visible).map(element => { const node = element as HTMLElement;
                return { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
                    text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
                    ariaLabel: element.getAttribute('aria-label'), dataTestId: element.getAttribute('data-testid'),
                    type: element.getAttribute('type'), required: element.hasAttribute('required')
                        || element.getAttribute('aria-required') === 'true',
                    disabled: element instanceof HTMLButtonElement || element instanceof HTMLInputElement
                        ? element.disabled : element.getAttribute('aria-disabled') === 'true',
                    checked: element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-checked') === 'true' }; });
        return { dialogs: roots.map(root => ({ role: root.getAttribute('role'),
            text: ((root as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500),
            dataTestId: root.getAttribute('data-testid') })), controls };
    });
    const confirmations = dom.controls.filter(control => !control.disabled
        && isDzen1045FinalDialogControl(control.ariaLabel || control.text));
    return { providerId: DZEN1045_PHASE_B.providerId, exactPackage: true, currentUrl: page.url(),
        dialogOpenClicks: 1, finalConfirmationClicks: 0, readOnlyEnforced: true,
        dialogs: dom.dialogs, controls: dom.controls, enabledConfirmationControls: confirmations,
        requiredControls: dom.controls.filter(control => control.required), blockedWrites,
        checkedAt: new Date().toISOString() };
}
