import type { Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { DZEN1045_PHASE_A_V2_RECONCILE } from '../dzen_task1045_phase_a_v2_reconcile_contract';
import { DZEN_EDITOR_SELECTORS } from './dzen_dom_helpers';
import { dzen1045PackageMatches, readDzen1045EditorPackage } from './dzen1045_second_attempt';
import { isDzen1045ReconcileWriteMethod } from './dzen1045_phase_a_v2_reconcile';

export function isDzen1045PersistenceControl(label: string): boolean {
    return /^(?:сохранить|сохранить черновик|save|save draft)$/i.test(label.replace(/\s+/g, ' ').trim());
}

function sanitizedDetailSemantics(payload: unknown) {
    const schemaKeys = new Set<string>(); const stateFields: Record<string, string | number | boolean | null> = {};
    const visit = (value: unknown, path: string, depth: number): void => {
        if (depth > 6 || schemaKeys.size > 300) return;
        if (Array.isArray(value)) { value.slice(0, 20).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1)); return; }
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
            const fieldPath = path ? `${path}.${key}` : key; schemaKeys.add(fieldPath);
            if (/(?:^|_)(?:id|status|state|draft|published|isDeleted|moderation|author|publisher|visibility)(?:$|_)/i.test(key)
                && (child === null || ['string', 'number', 'boolean'].includes(typeof child))) {
                stateFields[fieldPath] = typeof child === 'string' ? child.slice(0, 200) : child as number | boolean | null;
            }
            visit(child, fieldPath, depth + 1);
        }
    };
    visit(payload, '', 0); return { schemaKeys: Array.from(schemaKeys).sort(), stateFields };
}

/** Zero-click direct editor observation with all browser mutation requests aborted. */
export async function probeDzen1045ExactEditorState(page: Page, acceptedBody: string) {
    const blockedWrites: Array<{ method: string; host: string; path: string }> = [];
    const reads: Array<{ method: string; path: string; query: string; status?: number }> = [];
    let detailSemantics: ReturnType<typeof sanitizedDetailSemantics> | null = null;
    const detailParses = new Set<Promise<void>>();
    await page.setRequestInterception(true);
    page.on('request', request => {
        const method = request.method().toUpperCase();
        let url: URL; try { url = new URL(request.url()); } catch { void request.continue(); return; }
        if (isDzen1045ReconcileWriteMethod(method)) {
            if (blockedWrites.length < 100) blockedWrites.push({ method, host: url.hostname, path: url.pathname });
            void request.abort(); return;
        }
        if ((url.hostname === 'dzen.ru' || url.hostname.endsWith('.dzen.ru'))
            && method === 'GET' && reads.length < 100) reads.push({ method, path: url.pathname, query: url.search });
        void request.continue();
    });
    page.on('response', response => {
        try {
            const url = new URL(response.url());
            for (let index = reads.length - 1; index >= 0; index -= 1) {
                if (reads[index].path === url.pathname && reads[index].query === url.search
                    && reads[index].status === undefined) {
                    reads[index].status = response.status(); break;
                }
            }
            if (url.pathname === `/editor-api/v2/publisher/${DZEN1045.publisherId}/publication/${DZEN1045_PHASE_A_V2_RECONCILE.providerId}`
                && response.status() === 200) {
                const parsing = response.json().then(payload => { detailSemantics = sanitizedDetailSemantics(payload); })
                    .catch(() => undefined).then(() => undefined);
                detailParses.add(parsing); void parsing.finally(() => detailParses.delete(parsing));
            }
        } catch { /* bounded diagnostics only */ }
    });
    const providerId = DZEN1045_PHASE_A_V2_RECONCILE.providerId;
    const observed = await readDzen1045EditorPackage(page, providerId, acceptedBody);
    if (detailParses.size) await Promise.allSettled(Array.from(detailParses));
    const controls = await page.evaluate(() => {
        const visible = (element: Element) => { const node = element as HTMLElement; const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0; };
        return Array.from(document.querySelectorAll('button, [role="button"], input, [contenteditable="true"]'))
            .filter(visible).map(element => { const node = element as HTMLElement;
                return { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
                    text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
                    ariaLabel: element.getAttribute('aria-label'), dataTestId: element.getAttribute('data-testid'),
                    type: element.getAttribute('type'), contentEditable: element.getAttribute('contenteditable'),
                    disabled: element instanceof HTMLButtonElement || element instanceof HTMLInputElement
                        ? element.disabled : element.getAttribute('aria-disabled') === 'true' }; })
            .slice(0, 100);
    });
    const semanticControls = controls.filter(control => /(?:сохран|чернов|далее|опублик|save|draft|next|publish)/i
        .test(`${control.text} ${control.ariaLabel || ''} ${control.dataTestId || ''}`));
    return { providerId, currentUrl: page.url(), clickedControls: 0, readOnlyEnforced: true,
        exactPackage: dzen1045PackageMatches(observed), observed, controls, semanticControls,
        persistenceControls: semanticControls.filter(control => isDzen1045PersistenceControl(
            control.ariaLabel || control.text)),
        finalSubmitControls: semanticControls.filter(control => /(?:опублик|publish)/i
            .test(`${control.text} ${control.ariaLabel || ''}`)),
        readiness: { exactTitleBodyCover: dzen1045PackageMatches(observed),
            enabledPersistenceControls: semanticControls.filter(control => !control.disabled
                && isDzen1045PersistenceControl(control.ariaLabel || control.text)).length,
            enabledFinalSubmitControls: semanticControls.filter(control => !control.disabled
                && /(?:опублик|publish)/i.test(`${control.text} ${control.ariaLabel || ''}`)).length },
        detailSemantics, inventoryReads: reads.filter(read => /publications/.test(read.path)),
        titleSelector: DZEN_EDITOR_SELECTORS.articleTitle, bodySelector: DZEN_EDITOR_SELECTORS.articleBody,
        blockedWrites, reads, checkedAt: new Date().toISOString() };
}
