import type { ElementHandle, HTTPResponse, Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { DZEN1045_PHASE_B } from '../dzen_task1045_phase_b_contract';
import { enumerateDzen1045Studio } from './dzen1045_existing_draft';
import { dzen1045PackageMatches, readDzen1045EditorPackage,
    verifyDzen1045PublicBody } from './dzen1045_second_attempt';
import { extractPublicDzenUrlsFromPayload, waitForDzenPublicationOutcome } from './dzen_publication_outcome';

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
function detailDraftStatus(payload: unknown): string {
    const publications = Array.isArray(record(payload).publications) ? record(payload).publications as unknown[] : [];
    const target = record(publications.find(item => String(record(item).id || '') === DZEN1045_PHASE_B.providerId));
    return String(record(target.privateData).status || '');
}

/** Reuses the exact durable editor object and performs exactly one publication click. */
export async function publishDzen1045ExistingDraftOnce(page: Page, acceptedBody: string) {
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    const before = await enumerateDzen1045Studio(page, listUrl, 'published');
    if (!before.coverageComplete || before.publications.some(item => item.provider_object_id === DZEN1045_PHASE_B.providerId)) {
        throw new Error('[DZEN1045_PHASE_B_PUBLIC_COLLISION]');
    }
    let status = ''; const providerUrls = new Set<string>(); const pending = new Set<Promise<void>>();
    const capture = (response: HTTPResponse): void => {
        const requestMethod = response.request().method().toUpperCase();
        let url: URL; try { url = new URL(response.url()); } catch { return; }
        if (url.hostname !== 'dzen.ru' && !url.hostname.endsWith('.dzen.ru')) return;
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('json')) return;
        const parsing = response.json().then(payload => {
            if (url.pathname === `/editor-api/v2/publisher/${DZEN1045.publisherId}/publication/${DZEN1045_PHASE_B.providerId}`) {
                status = detailDraftStatus(payload);
            }
            if (['POST', 'PUT', 'PATCH'].includes(requestMethod)) {
                extractPublicDzenUrlsFromPayload(payload).forEach(value => providerUrls.add(value));
            }
        }).catch(() => undefined).then(() => undefined);
        pending.add(parsing); void parsing.finally(() => pending.delete(parsing));
    };
    page.on('response', capture);
    try {
        const observed = await readDzen1045EditorPackage(page, DZEN1045_PHASE_B.providerId, acceptedBody);
        if (pending.size) await Promise.allSettled(Array.from(pending));
        if (!dzen1045PackageMatches(observed) || status !== 'draft') {
            throw new Error(`[DZEN1045_PHASE_B_EXACT_DRAFT_REQUIRED] ${JSON.stringify({ status,
                exactPackage: dzen1045PackageMatches(observed) })}`);
        }
        const candidates = await page.$$(DZEN1045_PHASE_B.finalSelector);
        const enabled: Array<ElementHandle<Element>> = [];
        for (const candidate of candidates) {
            const state = await candidate.evaluate(element => { const node = element as HTMLElement;
                const style = getComputedStyle(node); return {
                    visible: style.display !== 'none' && style.visibility !== 'hidden'
                        && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
                    disabled: element instanceof HTMLButtonElement ? element.disabled
                        : element.getAttribute('aria-disabled') === 'true',
                    label: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() }; });
            if (state.visible && !state.disabled && /^(?:опубликовать|publish)$/i.test(state.label)) enabled.push(candidate);
        }
        if (enabled.length !== 1) throw new Error('[DZEN1045_PHASE_B_FINAL_CONTROL_NOT_EXACT]');
        await enabled[0].click();
        const previousUrls = before.publications.map(item => item.public_url).filter((url): url is string => Boolean(url));
        const outcome = await waitForDzenPublicationOutcome(page, DZEN1045_PHASE_B.finalSelector,
            previousUrls, providerUrls, 30_000);
        const published = await enumerateDzen1045Studio(page, listUrl, 'published');
        const target = published.publications.find(item => item.provider_object_id === DZEN1045_PHASE_B.providerId);
        if (!published.coverageComplete || !target?.public_url || !target.published_at) {
            throw new Error(`[DZEN1045_PHASE_B_SUBMIT_UNCERTAIN] ${JSON.stringify({ outcome,
                providerId: DZEN1045_PHASE_B.providerId })}`);
        }
        const reopened = await readDzen1045EditorPackage(page, DZEN1045_PHASE_B.providerId, acceptedBody);
        if (!dzen1045PackageMatches(reopened)
            || !await verifyDzen1045PublicBody(page, target.public_url, acceptedBody)) {
            throw new Error('[DZEN1045_PHASE_B_PUBLIC_READBACK_MISMATCH]');
        }
        return { public_url: target.public_url, provider_object_id: DZEN1045_PHASE_B.providerId,
            published_at: target.published_at, public_body_matches: true as const,
            public_asset_matches: true as const, checked_at: new Date().toISOString(),
            final_submit_count: 1 as const };
    } finally { page.off('response', capture); }
}
