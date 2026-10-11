import type { ElementHandle, HTTPRequest, HTTPResponse, Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import type { Dzen1045DurableDraftProofV2,
    Dzen1045ProviderTraceEntry } from '../dzen_task1045_phase_a_v2_contract';
import { DZEN_EDITOR_SELECTORS, typeDzenContentEditableText } from './dzen_dom_helpers';
import { inspectDzen1045RestoreIncident } from './dzen1045_restore_reconcile';

type ArticleOptionState = { visible: boolean; disabled: boolean; role: string | null;
    ariaLabel: string | null; text: string };
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH']);

function extractIds(value: unknown, found = new Set<string>(), depth = 0): string[] {
    if (depth > 6 || found.size >= 20) return Array.from(found);
    if (typeof value === 'string' && /^[a-f0-9]{16,64}$/i.test(value)) found.add(value.toLowerCase());
    else if (Array.isArray(value)) value.slice(0, 100).forEach(item => extractIds(item, found, depth + 1));
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>)
        .slice(0, 100).forEach(item => extractIds(item, found, depth + 1));
    return Array.from(found);
}

export function hasDzen1045MutationAcknowledgement(trace: Dzen1045ProviderTraceEntry[], draftId: string,
    stages: string[]): boolean {
    return trace.some(item => item.event === 'response' && MUTATIONS.has(item.method)
        && stages.includes(item.stage) && typeof item.status === 'number'
        && item.status >= 200 && item.status < 300
        && (item.ids?.includes(draftId) || item.path.includes(draftId)));
}

/** Exact evidence-backed two-click route. No publish/final-submit selector exists here. */
export async function openDzen1045ArticleComposerV2(page: Page, setStage: (stage: string) => void = () => undefined) {
    const publicationsUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    setStage('navigation');
    await page.goto(publicationsUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
    if (/login|passport\.yandex/i.test(page.url())) throw new Error('[DZEN1045_PHASE_A_V2_AUTH_REQUIRED]');
    await page.waitForSelector(DZEN_EDITOR_SELECTORS.addPublication, { visible: true, timeout: 15_000 });
    setStage('menu'); await page.click(DZEN_EDITOR_SELECTORS.addPublication);
    await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleMenuItem, { visible: true, timeout: 10_000 });
    const candidates = await page.$$(DZEN_EDITOR_SELECTORS.articleMenuItem);
    const exact: Array<ElementHandle<Element>> = [];
    for (const candidate of candidates) {
        const state = await candidate.evaluate(element => {
            const node = element as HTMLElement; const style = getComputedStyle(node);
            return { visible: style.display !== 'none' && style.visibility !== 'hidden'
                && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
            disabled: element instanceof HTMLButtonElement ? element.disabled
                : element.getAttribute('aria-disabled') === 'true',
            role: element.getAttribute('role'), ariaLabel: element.getAttribute('aria-label'),
            text: (node.innerText || '').replace(/\s+/g, ' ').trim() } satisfies ArticleOptionState;
        });
        const label = (state.ariaLabel || state.text).replace(/\s+/g, ' ').trim();
        if (state.visible && !state.disabled && state.role === 'button' && label === 'Написать статью') exact.push(candidate);
    }
    if (exact.length === 0) throw new Error('[DZEN1045_PHASE_A_V2_ARTICLE_OPTION_NOT_EXACT]');
    if (exact.length !== 1) throw new Error('[DZEN1045_PHASE_A_V2_ARTICLE_OPTION_AMBIGUOUS]');
    setStage('article_option');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => undefined),
        exact[0].click()
    ]);
    await page.waitForFunction(() => /\/profile\/editor\/id\/[^/]+\/[^/]+\/edit(?:[/?#]|$)/.test(location.href),
        { timeout: 15_000 });
    const draftId = page.url().match(/\/profile\/editor\/id\/[^/]+\/([a-f0-9]{16,64})\/edit(?:[/?#]|$)/i)?.[1];
    if (!draftId) throw new Error('[DZEN1045_PHASE_A_V2_PROVIDER_ID_MISSING]');
    const helpClose = await page.$(DZEN_EDITOR_SELECTORS.helpClose);
    if (helpClose) await helpClose.click();
    return { draftId: draftId.toLowerCase(), currentUrl: page.url(), creationControlsClicked: 2 as const };
}

async function waitForAcknowledgement(trace: Dzen1045ProviderTraceEntry[], draftId: string,
    stages: string[], pending: Set<Promise<void>>, wait: (milliseconds: number) => Promise<void>): Promise<boolean> {
    for (let elapsed = 0; elapsed < 15_000; elapsed += 250) {
        if (pending.size) await Promise.allSettled(Array.from(pending));
        if (hasDzen1045MutationAcknowledgement(trace, draftId, stages)) return true;
        await wait(250);
    }
    if (pending.size) await Promise.allSettled(Array.from(pending));
    return hasDzen1045MutationAcknowledgement(trace, draftId, stages);
}

/** Creates and proves one durable draft using the observed menu and provider acknowledgement contract. */
export async function createDzen1045DurableDraftPhaseAV2(page: Page, acceptedBody: string, imageUrl: string,
    ports: { uploadImage(url: string): Promise<void>;
        fillEditor?(title: string, body: string): Promise<void>;
        inspect?(): ReturnType<typeof inspectDzen1045RestoreIncident>;
        wait?(milliseconds: number): Promise<void> }): Promise<Dzen1045DurableDraftProofV2> {
    const trace: Dzen1045ProviderTraceEntry[] = [];
    const requestStages = new WeakMap<HTTPRequest, string>();
    const pending = new Set<Promise<void>>();
    const wait = ports.wait || ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
    let stage = 'navigation';
    const captureRequest = (request: HTTPRequest): void => {
        let url: URL; try { url = new URL(request.url()); } catch { return; }
        if (url.hostname !== 'dzen.ru' && !url.hostname.endsWith('.dzen.ru')) return;
        const method = request.method().toUpperCase(); requestStages.set(request, stage);
        if (trace.length < 500 || MUTATIONS.has(method)) {
            trace.push({ event: 'request', method, path: url.pathname, stage });
        }
    };
    const captureResponse = (response: HTTPResponse): void => {
        let url: URL; try { url = new URL(response.url()); } catch { return; }
        if (url.hostname !== 'dzen.ru' && !url.hostname.endsWith('.dzen.ru')) return;
        const request = response.request(); const method = request.method().toUpperCase();
        const entry: Dzen1045ProviderTraceEntry = { event: 'response', method, path: url.pathname,
            stage: requestStages.get(request) || stage, status: response.status() };
        if (trace.length < 500 || MUTATIONS.has(method)) trace.push(entry);
        const contentType = response.headers()['content-type'] || '';
        if (!MUTATIONS.has(method) || !contentType.includes('json')) return;
        const parsing = response.json().then(payload => { entry.ids = extractIds(payload); })
            .catch(() => undefined).then(() => undefined);
        pending.add(parsing); void parsing.finally(() => pending.delete(parsing));
    };
    page.on('request', captureRequest); page.on('response', captureResponse);
    try {
        stage = 'navigation';
        const publicationsUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
        const opened = await openDzen1045ArticleComposerV2(page, value => { stage = value; });
        if (!await waitForAcknowledgement(trace, opened.draftId, ['article_option'], pending, wait)) {
            throw new Error(`[DZEN1045_PHASE_A_V2_CREATION_UNACKNOWLEDGED] ${JSON.stringify({
                draftId: opened.draftId, currentUrl: opened.currentUrl, trace })}`);
        }
        stage = 'fill';
        if (ports.fillEditor) await ports.fillEditor(DZEN1045.publicTitle, acceptedBody);
        else {
            const title = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleTitle, { timeout: 15_000 });
            const body = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleBody, { timeout: 15_000 });
            if (!title || !body) throw new Error('[DZEN1045_PHASE_A_V2_EDITOR_UNAVAILABLE]');
            await typeDzenContentEditableText(title, DZEN1045.publicTitle);
            await typeDzenContentEditableText(body, acceptedBody);
        }
        stage = 'asset'; await ports.uploadImage(imageUrl);
        stage = 'blur'; await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        const saveControls: Array<ElementHandle<Element>> = [];
        for (const candidate of await page.$$('button, [role="button"]')) {
            const state = await candidate.evaluate(element => {
                const node = element as HTMLElement; const style = getComputedStyle(node);
                return { visible: style.display !== 'none' && style.visibility !== 'hidden'
                    && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
                label: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
                disabled: element instanceof HTMLButtonElement ? element.disabled
                    : element.getAttribute('aria-disabled') === 'true' };
            });
            if (state.visible && !state.disabled && /^(?:сохранить|сохранить черновик|save|save draft)$/i.test(state.label)) saveControls.push(candidate);
        }
        if (saveControls.length > 1) throw new Error('[DZEN1045_PHASE_A_V2_SAVE_CONTROL_AMBIGUOUS]');
        let persistenceTrigger: Dzen1045DurableDraftProofV2['persistenceTrigger'];
        let saveControlsClicked: 0 | 1 = 0;
        if (saveControls[0]) {
            stage = 'save'; await saveControls[0].click(); saveControlsClicked = 1;
            if (!await waitForAcknowledgement(trace, opened.draftId, ['save'], pending, wait)) {
                throw new Error(`[DZEN1045_PHASE_A_V2_SAVE_UNACKNOWLEDGED] ${JSON.stringify({ trace })}`);
            }
            persistenceTrigger = 'semantic_save_control';
        } else {
            if (!await waitForAcknowledgement(trace, opened.draftId, ['fill', 'asset', 'blur'], pending, wait)) {
                throw new Error(`[DZEN1045_PHASE_A_V2_AUTOSAVE_UNACKNOWLEDGED] ${JSON.stringify({ trace })}`);
            }
            persistenceTrigger = 'acknowledged_autosave_then_studio_navigation';
        }
        stage = 'readback';
        await page.goto(`${publicationsUrl}?state=draft`, { waitUntil: 'networkidle2', timeout: 30_000 });
        const inspection = ports.inspect ? await ports.inspect() : await inspectDzen1045RestoreIncident(page, acceptedBody);
        if (inspection.kind !== 'sole_exact_draft' || inspection.draft.draftId !== opened.draftId) {
            throw new Error(`[DZEN1045_PHASE_A_V2_DURABLE_READBACK_FAILED] ${JSON.stringify({
                expectedDraftId: opened.draftId, inspection, trace })}`);
        }
        return { draftId: opened.draftId, editorUrl: opened.currentUrl, coverId: inspection.draft.coverId,
            title: DZEN1045.publicTitle, bodySha256: DZEN1045.bodySha, coverSha256: DZEN1045.assetSha,
            publishedCoverageComplete: true, draftCoverageComplete: true,
            exactPublishedMatches: 0, exactDraftMatches: 1, creationAcknowledged: true,
            persistenceAcknowledged: true, creationControlsClicked: opened.creationControlsClicked,
            saveControlsClicked, finalSubmitCount: 0,
            persistenceTrigger, providerTrace: trace, provenAt: new Date().toISOString() };
    } finally {
        page.off('request', captureRequest); page.off('response', captureResponse);
    }
}
