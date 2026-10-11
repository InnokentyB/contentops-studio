import type { HTTPResponse, Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { assertDzen1045ZeroRelevantInventory } from '../dzen_task1045_zero_restore_contract';
import { DZEN_EDITOR_SELECTORS, typeDzenContentEditableText } from './dzen_dom_helpers';
import { enumerateDzen1045Studio } from './dzen1045_existing_draft';
import { inspectDzen1045SecondAttempt, verifyDzen1045PublicBody } from './dzen1045_second_attempt';
import { clickDzenPublicationConfirm } from './dzen_publication_outcome';

/** One provider operation: reconcile, finish one exact draft, or create/read/submit one draft. */
export async function restoreDzen1045InBrowser(page: Page, acceptedBody: string, imageUrl: string,
    ports: { openComposer(): Promise<void>; uploadImage(url: string): Promise<void> }) {
    const saveTrace: Array<{ method: string; path: string; status: number }> = [];
    const captureSave = (response: HTTPResponse): void => {
        const method = response.request().method().toUpperCase();
        if (!['POST', 'PUT', 'PATCH'].includes(method)) return;
        try {
            const url = new URL(response.url());
            if (url.hostname === 'dzen.ru' || url.hostname.endsWith('.dzen.ru')) {
                saveTrace.push({ method, path: url.pathname, status: response.status() });
                if (saveTrace.length > 20) saveTrace.shift();
            }
        } catch { /* non-URL responses are irrelevant */ }
    };
    page.on('response', captureSave);
    try {
        let inspection = await inspectDzen1045SecondAttempt(page, acceptedBody);
        let created = false;
        if (inspection.kind === 'no_exact_match') {
            assertDzen1045ZeroRelevantInventory(inspection);
            await ports.openComposer();
            const title = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleTitle, { timeout: 15_000 });
            const body = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articleBody, { timeout: 15_000 });
            if (!title || !body) throw new Error('[DZEN1045_RESTORE_EDITOR_UNAVAILABLE]');
            await typeDzenContentEditableText(title, DZEN1045.publicTitle);
            await typeDzenContentEditableText(body, acceptedBody);
            await ports.uploadImage(imageUrl);
            created = true;
            await new Promise(resolve => setTimeout(resolve, 4_000));
            inspection = await inspectDzen1045SecondAttempt(page, acceptedBody);
        }
        if (inspection.kind === 'no_exact_match') {
            throw new Error(`[DZEN1045_DURABLE_DRAFT_NOT_CONFIRMED] ${JSON.stringify(inspection.diagnostics)}`);
        }
        if (inspection.kind === 'exact_published') return { mode: 'reconciled' as const, created,
            finalSubmitCount: 0, publication: inspection.publication, saveTrace };
        const proof = inspection.proof;
        await clickDzenPublicationConfirm(page, DZEN_EDITOR_SELECTORS.publicationConfirm);
        const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
        for (let check = 0; check < 20; check += 1) {
            await new Promise(resolve => setTimeout(resolve, 1_000));
            const published = await enumerateDzen1045Studio(page, listUrl, 'published');
            const match = published.publications.find(item => item.state === 'published'
                && item.provider_object_id === proof.draftId && item.title === DZEN1045.publicTitle);
            if (published.coverageComplete && match?.public_url && match.published_at
                && await verifyDzen1045PublicBody(page, match.public_url, acceptedBody)) {
                return { mode: 'submitted' as const, created, finalSubmitCount: 1, proof,
                    publication: { public_url: match.public_url, provider_object_id: proof.draftId,
                        published_at: match.published_at, public_body_matches: true as const,
                        public_asset_matches: true as const, checked_at: new Date().toISOString() }, saveTrace };
            }
        }
        throw new Error('[DZEN1045_RESTORE_SUBMIT_UNCERTAIN] Exact public object not confirmed');
    } finally {
        page.off('response', captureSave);
    }
}
