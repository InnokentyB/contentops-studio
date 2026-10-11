import type { ElementHandle, HTTPResponse, Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { DZEN1045_PHASE_C, dzen1045DialogFingerprint, isDzen1045HeaderPublishControl,
    type Dzen1045DialogControl, type Dzen1045DialogInspection, type Dzen1045PublishDialog,
    type Dzen1045PhaseCPublication } from '../dzen_task1045_phase_c_contract';
import { enumerateDzen1045Studio } from './dzen1045_existing_draft';
import { dzen1045PackageMatches, readDzen1045EditorPackage, verifyDzen1045PublicBody } from './dzen1045_second_attempt';
import { extractPublicDzenUrlsFromPayload, waitForDzenPublicationOutcome } from './dzen_publication_outcome';
import { isDzen1045ReconcileWriteMethod } from './dzen1045_phase_a_v2_reconcile';

type Trace = { method: string; path: string; status: number; publicUrls: string[] };
const HELP_TEXT = 'Статья — это в первую очередь текст';
const PROMO_TEXT = 'Новые функции в статье';
const FINAL_LABEL = /^(?:опубликовать|publish)$/i;

async function visibleOverlay(page: Page, needle: string): Promise<boolean> {
    return page.evaluate(text => Array.from(document.querySelectorAll('body *')).some(element => {
        const node = element as HTMLElement; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
        const content = (node.innerText || '').replace(/\s+/g, ' ').trim();
        return content.startsWith(text) && content.length < text.length + 300
            && style.display !== 'none' && style.visibility !== 'hidden'
            && rect.width > 0 && rect.height > 0;
    }), needle);
}

async function dismissKnownOverlays(page: Page): Promise<{ dismissed: string[]; retained: string[] }> {
    const dismissed: string[] = []; const retained: string[] = [];
    if (await visibleOverlay(page, HELP_TEXT)) {
        const closes = await page.$$('[aria-label="Закрыть"]');
        const visible = [];
        for (const close of closes) {
            if (await close.evaluate(element => { const node = element as HTMLElement; const rect = node.getBoundingClientRect();
                const style = getComputedStyle(node); const dialog = element.closest('[role="dialog"], [aria-modal="true"]');
                return Boolean(dialog && (dialog as HTMLElement).innerText.includes('Статья — это в первую очередь текст'))
                    && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; })) visible.push(close);
        }
        if (visible.length !== 1) throw new Error('[DZEN1045_PHASE_C_HELP_CLOSE_NOT_EXACT]');
        await visible[0].click(); dismissed.push('article_help');
    }
    if (await visibleOverlay(page, PROMO_TEXT)) {
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 150));
        if (await visibleOverlay(page, PROMO_TEXT)) retained.push('article_promo');
        else dismissed.push('article_promo');
    }
    // Dzen can retain a visible help fragment after the modal close animation.
    // It is safe to continue only because exactHeaderControl performs a
    // coordinate-level elementFromPoint check and rejects an obscured target.
    if (await visibleOverlay(page, HELP_TEXT)) retained.push('article_help_residual');
    return { dismissed, retained };
}

async function exactHeaderControl(page: Page): Promise<ElementHandle<Element>> {
    const controls = await page.$$('[data-testid="article-publish-btn"]'); const exact: Array<ElementHandle<Element>> = [];
    for (const control of controls) {
        const state = await control.evaluate(element => { const node = element as HTMLElement; const rect = node.getBoundingClientRect();
            const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { text: (node.innerText || '').replace(/\s+/g, ' ').trim(), dataTestId: element.getAttribute('data-testid'),
                disabled: element instanceof HTMLButtonElement ? element.disabled : element.getAttribute('aria-disabled') === 'true',
                geometry: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
                topmost: center === element || Boolean(center && element.contains(center)) }; });
        if (isDzen1045HeaderPublishControl(state)) exact.push(control);
    }
    if (exact.length !== 1) throw new Error('[DZEN1045_PHASE_C_HEADER_CONTROL_NOT_EXACT]');
    return exact[0];
}

async function capturePublishDialog(page: Page): Promise<{ dialog: Dzen1045PublishDialog; final: ElementHandle<Element> }> {
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="drawer"]'))
        .some(element => { const node = element as HTMLElement; const text = node.innerText || ''; const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node); return /опубликовать|publish/i.test(text)
                && !text.includes('Статья — это в первую очередь текст') && style.display !== 'none'
                && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; }), { timeout: 8_000 });
    const handles = await page.$$('button, [role="button"]'); const final: Array<ElementHandle<Element>> = [];
    for (const handle of handles) {
        const state = await handle.evaluate(element => { const node = element as HTMLElement; const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node); const dialog = element.closest('[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="drawer"]');
            return { visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
                inDialog: Boolean(dialog), help: Boolean(dialog && (dialog as HTMLElement).innerText.includes('Статья — это в первую очередь текст')),
                label: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
                disabled: element instanceof HTMLButtonElement ? element.disabled : element.getAttribute('aria-disabled') === 'true' }; });
        if (state.visible && state.inDialog && !state.help && !state.disabled && FINAL_LABEL.test(state.label)) final.push(handle);
    }
    if (final.length !== 1) throw new Error('[DZEN1045_PHASE_C_FINAL_CONTROL_NOT_EXACT]');
    const dialog = await final[0].evaluate(element => { const root = element.closest('[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="drawer"]')!;
        const visible = (candidate: Element) => { const node = candidate as HTMLElement; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; };
        const controls: Dzen1045DialogControl[] = Array.from(root.querySelectorAll('button, [role="button"]')).filter(visible).map(candidate => {
            const node = candidate as HTMLElement; const rect = node.getBoundingClientRect(); return { tag: candidate.tagName.toLowerCase(),
                text: (node.innerText || candidate.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
                dataTestId: candidate.getAttribute('data-testid'), disabled: candidate instanceof HTMLButtonElement
                    ? candidate.disabled : candidate.getAttribute('aria-disabled') === 'true',
                geometry: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } }; });
        const requiredControls = Array.from(root.querySelectorAll('input[required], select[required], textarea[required]')).filter(visible)
            .map(candidate => ({ label: candidate.getAttribute('aria-label') || candidate.getAttribute('name') || '',
                value: (candidate as HTMLInputElement).value || '' }));
        return { text: (root as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 3000), controls, requiredControls };
    });
    return { dialog, final: final[0] };
}

async function prepare(page: Page, acceptedBody: string, blockWrites: boolean): Promise<Dzen1045DialogInspection & {
    final: ElementHandle<Element>; blockedWrites: Array<{ method: string; path: string }>;
    dismissedOverlays: string[]; retainedOverlays: string[] }> {
    const blockedWrites: Array<{ method: string; path: string }> = [];
    if (blockWrites) { await page.setRequestInterception(true); page.on('request', request => { const method = request.method().toUpperCase();
        let url: URL; try { url = new URL(request.url()); } catch { void request.continue(); return; }
        if (isDzen1045ReconcileWriteMethod(method)) { blockedWrites.push({ method, path: url.pathname }); void request.abort(); return; }
        void request.continue(); }); }
    const observed = await readDzen1045EditorPackage(page, DZEN1045_PHASE_C.providerId, acceptedBody);
    if (!dzen1045PackageMatches(observed)) throw new Error('[DZEN1045_PHASE_C_EXACT_DRAFT_REQUIRED]');
    const overlays = await dismissKnownOverlays(page); const header = await exactHeaderControl(page);
    await header.click(); const captured = await capturePublishDialog(page); const fingerprint = dzen1045DialogFingerprint(captured.dialog);
    return { dialog: captured.dialog, fingerprint, exactDraft: true, finalConfirmationClicks: 0,
        providerWrites: 0, final: captured.final, blockedWrites,
        dismissedOverlays: overlays.dismissed, retainedOverlays: overlays.retained };
}

export async function previewDzen1045PhaseC(page: Page, acceptedBody: string) {
    const inspected = await prepare(page, acceptedBody, true);
    return { dialog: inspected.dialog, fingerprint: inspected.fingerprint, exactDraft: true as const,
        finalConfirmationClicks: 0 as const, providerWrites: 0 as const,
        blockedWrites: inspected.blockedWrites, dismissedOverlays: inspected.dismissedOverlays,
        retainedOverlays: inspected.retainedOverlays,
        checkedAt: new Date().toISOString() };
}

export async function publishDzen1045PhaseCOnce(page: Page, acceptedBody: string,
    expectedDialogFingerprint: string): Promise<Dzen1045PhaseCPublication> {
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    const before = await enumerateDzen1045Studio(page, listUrl, 'published');
    if (!before.coverageComplete || before.publications.some(item => item.provider_object_id === DZEN1045_PHASE_C.providerId)) {
        throw new Error('[DZEN1045_PHASE_C_PUBLIC_COLLISION]');
    }
    const inspected = await prepare(page, acceptedBody, false);
    if (inspected.fingerprint !== expectedDialogFingerprint) throw new Error('[DZEN1045_PHASE_C_DIALOG_FINGERPRINT_MISMATCH]');
    const providerUrls = new Set<string>(); const trace: Trace[] = []; const pending = new Set<Promise<void>>();
    const capture = (response: HTTPResponse) => { const method = response.request().method().toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return; let url: URL;
        try { url = new URL(response.url()); } catch { return; }
        if (url.hostname !== 'dzen.ru' && !url.hostname.endsWith('.dzen.ru')) return;
        const parsing = response.json().then(payload => { const urls = extractPublicDzenUrlsFromPayload(payload);
            urls.forEach(value => providerUrls.add(value)); trace.push({ method, path: url.pathname, status: response.status(), publicUrls: urls });
        }).catch(() => { trace.push({ method, path: url.pathname, status: response.status(), publicUrls: [] }); }).then(() => undefined);
        pending.add(parsing); void parsing.finally(() => pending.delete(parsing)); };
    page.on('response', capture);
    try {
        await inspected.final.click();
        const previousUrls = before.publications.map(item => item.public_url).filter((url): url is string => Boolean(url));
        const outcome = await waitForDzenPublicationOutcome(page, '[data-testid="article-publish-btn"]', previousUrls, providerUrls, 30_000);
        if (pending.size) await Promise.allSettled(Array.from(pending));
        const published = await enumerateDzen1045Studio(page, listUrl, 'published');
        const target = published.publications.find(item => item.provider_object_id === DZEN1045_PHASE_C.providerId);
        if (!published.coverageComplete || !target?.public_url || !target.published_at || outcome.kind === 'rejected') {
            throw new Error(`[DZEN1045_PHASE_C_SUBMIT_UNCERTAIN] ${JSON.stringify({ outcome, trace })}`);
        }
        const publicPackage = await readDzen1045EditorPackage(page, DZEN1045_PHASE_C.providerId, acceptedBody);
        const bodyMatches = await verifyDzen1045PublicBody(page, target.public_url, acceptedBody);
        if (!dzen1045PackageMatches(publicPackage) || !bodyMatches || target.title !== DZEN1045.publicTitle) {
            throw new Error('[DZEN1045_PHASE_C_PUBLIC_READBACK_MISMATCH]');
        }
        return { public_url: target.public_url, provider_object_id: DZEN1045_PHASE_C.providerId,
            published_at: target.published_at, public_body_matches: true, public_asset_matches: true,
            public_title_matches: true, checked_at: new Date().toISOString(), final_submit_count: 1, provider_trace: trace };
    } finally { page.off('response', capture); }
}
