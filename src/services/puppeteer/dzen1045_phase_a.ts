import type { HTTPResponse, Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import type { Dzen1045DurableDraftProof } from '../dzen_task1045_phase_a_contract';
import { DZEN_EDITOR_SELECTORS, typeDzenContentEditableText } from './dzen_dom_helpers';
import { inspectDzen1045RestoreIncident } from './dzen1045_restore_reconcile';

type SaveCandidateState = { visible: boolean; label: string; disabled: boolean };

/** Creates and durably proves one draft. There is intentionally no final-submit operation here. */
export async function createDzen1045DurableDraftPhaseA(page: Page, acceptedBody: string, imageUrl: string,
    ports: { openComposer(): Promise<void>; uploadImage(url: string): Promise<void>;
        fillEditor?(title: string, body: string): Promise<void>;
        inspect?(): ReturnType<typeof inspectDzen1045RestoreIncident>;
        wait?(milliseconds: number): Promise<void> }): Promise<Dzen1045DurableDraftProof> {
    const providerTrace: Array<{ method: string; path: string; status: number }> = [];
    const capture = (response: HTTPResponse): void => {
        const method = response.request().method().toUpperCase();
        if (!['POST', 'PUT', 'PATCH'].includes(method)) return;
        try {
            const url = new URL(response.url());
            if ((url.hostname === 'dzen.ru' || url.hostname.endsWith('.dzen.ru')) && response.status() < 400) {
                providerTrace.push({ method, path: url.pathname, status: response.status() });
                if (providerTrace.length > 20) providerTrace.shift();
            }
        } catch { /* ignore malformed response URLs */ }
    };
    page.on('response', capture);
    try {
        await ports.openComposer();
        const draftId = page.url().match(/\/profile\/editor\/id\/[^/]+\/([a-f0-9]{16,64})\/edit(?:[/?#]|$)/)?.[1];
        if (!draftId) throw new Error('[DZEN1045_PHASE_A_PROVIDER_ID_MISSING]');
        if (ports.fillEditor) await ports.fillEditor(DZEN1045.publicTitle, acceptedBody);
        else {
            const title = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleTitle, { timeout: 15_000 });
            const body = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleBody, { timeout: 15_000 });
            if (!title || !body) throw new Error('[DZEN1045_PHASE_A_EDITOR_UNAVAILABLE]');
            await typeDzenContentEditableText(title, DZEN1045.publicTitle);
            await typeDzenContentEditableText(body, acceptedBody);
        }
        await ports.uploadImage(imageUrl);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await (ports.wait ? ports.wait(6_000) : new Promise(resolve => setTimeout(resolve, 6_000)));
        const saveControls = [];
        for (const candidate of await page.$$('button, [role="button"]')) {
            const state = await candidate.evaluate(element => {
                const node = element as HTMLElement; const style = window.getComputedStyle(node);
                return { visible: style.display !== 'none' && style.visibility !== 'hidden'
                    && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
                label: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
                disabled: element instanceof HTMLButtonElement ? element.disabled
                    : element.getAttribute('aria-disabled') === 'true' } satisfies SaveCandidateState;
            });
            if (state.visible && !state.disabled && /^(?:сохранить|сохранить черновик|save|save draft)$/i.test(state.label)) {
                saveControls.push(candidate);
            }
        }
        if (saveControls.length > 1) throw new Error('[DZEN1045_PHASE_A_SAVE_CONTROL_AMBIGUOUS]');
        const persistenceTrigger = saveControls.length === 1
            ? 'semantic_save_control' as const : 'editor_blur_then_studio_navigation' as const;
        if (saveControls[0]) { await saveControls[0].click();
            await (ports.wait ? ports.wait(3_000) : new Promise(resolve => setTimeout(resolve, 3_000))); }
        const inspection = ports.inspect ? await ports.inspect() : await inspectDzen1045RestoreIncident(page, acceptedBody);
        if (inspection.kind !== 'sole_exact_draft' || inspection.draft.draftId !== draftId) {
            throw new Error(`[DZEN1045_PHASE_A_DURABLE_READBACK_FAILED] ${JSON.stringify(inspection)}`);
        }
        return { draftId, coverId: inspection.draft.coverId, title: DZEN1045.publicTitle,
            bodySha256: DZEN1045.bodySha, coverSha256: DZEN1045.assetSha,
            publishedCoverageComplete: true, draftCoverageComplete: true,
            exactPublishedMatches: 0, exactDraftMatches: 1, persistenceTrigger,
            providerTrace, provenAt: new Date().toISOString() };
    } finally {
        page.off('response', capture);
    }
}
