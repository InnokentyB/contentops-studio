import { createHash } from 'node:crypto';
import type { Page } from 'puppeteer';
import { DZEN_EDITOR_SELECTORS, extractDzenStudioPublications, type DzenStudioPublication } from './dzen_dom_helpers';
import { clickDzenPublicationConfirm } from './dzen_publication_outcome';
import {
    DZEN1045,
    normalizeDzen1045Body,
    runDzen1045DraftResume,
    type Dzen1045DraftProof
} from '../dzen_task1045_resume_contract';

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

export type Dzen1045MatchDiagnostics = {
    publishedTitleMatches: number;
    draftTitleMatches: number;
    missingCover: number;
    bodyMismatches: number;
    coverMismatches: number;
    exactMatches: number;
};

export function dzen1045AmbiguityError(diagnostics: Dzen1045MatchDiagnostics): Error {
    return new Error(`[DZEN1045_DRAFT_AMBIGUOUS] ${JSON.stringify(diagnostics)}`);
}

function nextPageUrl(current: string, iteration: number, pageSize: number): string {
    const url = new URL(current);
    const offsetKey = ['offset', 'from'].find(key => url.searchParams.has(key));
    if (offsetKey) {
        url.searchParams.set(offsetKey, String(Number(url.searchParams.get(offsetKey) || 0) + pageSize));
        return url.toString();
    }
    const pageKey = ['page', 'pageNumber', 'pageNum'].find(key => url.searchParams.has(key)) || 'page';
    url.searchParams.set(pageKey, String(Number(url.searchParams.get(pageKey) || iteration) + 1));
    return url.toString();
}

export function dzen1045Pagination(raw: unknown, pageCount: number, pageSize: number, count: number) {
    const root = record(raw); const nested = record(root.pagination);
    const hasMore = [root.hasMore, root.has_more, nested.hasMore, nested.has_more]
        .find((value): value is boolean => typeof value === 'boolean');
    const total = [root.total, root.totalCount, root.total_count, nested.total, nested.totalCount]
        .find((value): value is number => typeof value === 'number' && Number.isSafeInteger(value));
    const shortPage = hasMore === undefined && total === undefined && pageCount < pageSize;
    return { complete: hasMore === false || (typeof total === 'number' && count >= total) || shortPage,
        hasMore, total };
}

async function enumerate(page: Page, listUrl: string, state: 'published' | 'draft') {
    const initial = page.waitForResponse(response => /\/editor-api\/v3\/publications\?/.test(response.url())
        && new URL(response.url()).searchParams.get('state') === state
        && response.status() === 200, { timeout: 30_000 });
    await page.goto(`${listUrl}?state=${state}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    let response = await initial;
    let responseUrl = response.url();
    let raw: unknown = await response.json();
    const collected: DzenStudioPublication[] = [];
    const seen = new Set<string>();
    for (let iteration = 1; iteration <= 100; iteration += 1) {
        const parsed = extractDzenStudioPublications(raw);
        if (!parsed?.title_readback_complete || !parsed.state_readback_complete) {
            throw new Error('[DZEN1045_STUDIO_ENUMERATION_INCOMPLETE] Missing title/state readback');
        }
        let added = 0;
        for (const publication of parsed.publications) {
            const key = publication.provider_object_id || `${publication.state}:${publication.title}:${publication.public_url}`;
            if (seen.has(key)) continue;
            seen.add(key); collected.push(publication); added += 1;
        }
        const pageSize = Number(new URL(responseUrl).searchParams.get('pageSize'));
        if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
            throw new Error('[DZEN1045_STUDIO_ENUMERATION_INCOMPLETE] Provider pageSize is missing');
        }
        const info = dzen1045Pagination(raw, parsed.publications.length, pageSize, collected.length);
        if (parsed.coverage_complete || info.complete) return { publications: collected, coverageComplete: true };
        if (iteration > 1 && added === 0) {
            throw new Error('[DZEN1045_STUDIO_ENUMERATION_INCOMPLETE] Pagination cannot be proven exhaustive');
        }
        responseUrl = nextPageUrl(responseUrl, iteration, pageSize);
        raw = await page.evaluate(async url => {
            const providerResponse = await fetch(url, { credentials: 'include' });
            if (!providerResponse.ok) throw new Error(`Dzen Studio page returned ${providerResponse.status}`);
            return providerResponse.json();
        }, responseUrl);
    }
    throw new Error('[DZEN1045_STUDIO_ENUMERATION_INCOMPLETE] Page bound exceeded');
}

async function coverBytes(draftId: string, coverId: string) {
    const response = await fetch(`https://avatars.dzeninfra.ru/get-zen_doc/271828/pub_${draftId}_${coverId}/orig`,
        { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('[DZEN1045_COVER_READBACK_FAILED]');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5_000_000) throw new Error('[DZEN1045_COVER_TOO_LARGE]');
    return bytes;
}

/** Locate and resume only the existing exact task1045 draft; never opens a composer or rewrites content. */
export async function resumeDzen1045InExistingDraft(page: Page, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string },
    claim: (proof: Dzen1045DraftProof) => Promise<boolean>) {
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    let selectedDraftId = '';
    return runDzen1045DraftResume(args, {
        inspect: async () => {
            const published = await enumerate(page, listUrl, 'published');
            const publicMatches = published.publications.filter(item => item.title === DZEN1045.title);
            const drafts = await enumerate(page, listUrl, 'draft');
            const candidates = drafts.publications.filter(item => item.state === 'draft'
                && item.title === DZEN1045.title && item.provider_object_id);
            const exact: Dzen1045DraftProof[] = [];
            const diagnostics: Dzen1045MatchDiagnostics = { publishedTitleMatches: publicMatches.length,
                draftTitleMatches: candidates.length, missingCover: 0, bodyMismatches: 0,
                coverMismatches: 0, exactMatches: 0 };
            for (const candidate of candidates) {
                const draftId = candidate.provider_object_id!;
                const pending = page.waitForResponse(response => new URL(response.url()).pathname
                    === `/editor-api/v2/publisher/${DZEN1045.publisherId}/publication/${draftId}`
                    && response.status() === 200, { timeout: 30_000 });
                await page.goto(`https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/${draftId}/edit`,
                    { waitUntil: 'networkidle2', timeout: 30_000 });
                const native = record(await (await pending).json());
                const items = Array.isArray(native.publications) ? native.publications : [];
                const draft = record(items.find(item => String(record(item).id || '') === draftId));
                const image = record(record(record(draft.content).preview).image);
                const coverId = String(image.id || '');
                if (!coverId) { diagnostics.missingCover += 1; continue; }
                const [title, body, bytes] = await Promise.all([
                    page.$eval(DZEN_EDITOR_SELECTORS.articleTitle, element => (element as HTMLElement).innerText),
                    page.$eval(DZEN_EDITOR_SELECTORS.articleBody, element => (element as HTMLElement).innerText),
                    coverBytes(draftId, coverId)
                ]);
                const bodyMatches = normalizeDzen1045Body(body) === normalizeDzen1045Body(acceptedBody);
                const coverSha = createHash('sha256').update(bytes).digest('hex');
                if (!bodyMatches) diagnostics.bodyMismatches += 1;
                if (coverSha !== DZEN1045.assetSha) diagnostics.coverMismatches += 1;
                if (title !== DZEN1045.title || !bodyMatches || coverSha !== DZEN1045.assetSha) continue;
                await page.click(DZEN_EDITOR_SELECTORS.articlePublish);
                await page.waitForSelector(DZEN_EDITOR_SELECTORS.publicationConfirm, { visible: true, timeout: 15_000 });
                const finalControlReady = await page.$eval(DZEN_EDITOR_SELECTORS.publicationConfirm, element =>
                    element instanceof HTMLButtonElement && !element.disabled
                    && element.getAttribute('aria-disabled') !== 'true');
                exact.push({ draftId, coverId, title, bodySha256: DZEN1045.bodySha,
                    coverSha256: coverSha, publishedMatches: publicMatches.length,
                    publishedCoverageComplete: published.coverageComplete, draftMatches: 1,
                    draftCoverageComplete: drafts.coverageComplete, finalControlReady });
            }
            diagnostics.exactMatches = exact.length;
            if (exact.length !== 1) throw dzen1045AmbiguityError(diagnostics);
            selectedDraftId = exact[0].draftId;
            return { ...exact[0], draftMatches: exact.length };
        },
        claim,
        submit: async proof => {
            if (proof.draftId !== selectedDraftId) throw new Error('[DZEN1045_DRAFT_CHANGED]');
            await clickDzenPublicationConfirm(page, DZEN_EDITOR_SELECTORS.publicationConfirm);
            await new Promise(resolve => setTimeout(resolve, 1500));
            const published = await enumerate(page, listUrl, 'published');
            const match = published.publications.find(item => item.state === 'published'
                && item.provider_object_id === proof.draftId && item.title === DZEN1045.title);
            if (!published.coverageComplete || !match?.public_url || !match.published_at) {
                throw new Error('[DZEN1045_RESUME_UNCERTAIN] Exact public object not confirmed');
            }
            await page.goto(match.public_url, { waitUntil: 'networkidle2', timeout: 30_000 });
            const bodyMatches = await page.evaluate(body => {
                const normalize = (value: string) => value.normalize('NFKC').replace(/^#{1,6}\s+/gm, '')
                    .replace(/^[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
                return normalize(document.body.innerText).includes(normalize(body));
            }, acceptedBody);
            if (!bodyMatches) throw new Error('[DZEN1045_PUBLIC_BODY_UNCONFIRMED]');
            return { public_url: match.public_url, provider_object_id: proof.draftId,
                published_at: match.published_at, public_body_matches: true,
                checked_at: new Date().toISOString() };
        }
    });
}
