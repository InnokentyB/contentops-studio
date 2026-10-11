import { createHash } from 'node:crypto';
import type { Page } from 'puppeteer';
import { DZEN_EDITOR_SELECTORS } from './dzen_dom_helpers';
import { clickDzenPublicationConfirm, resolveDzenPublicationConfirm } from './dzen_publication_outcome';
import {
    enumerateDzen1045Studio,
    readDzen1045CoverBytes
} from './dzen1045_existing_draft';
import { DZEN1045, normalizeDzen1045Body } from '../dzen_task1045_resume_contract';
import {
    runDzen1045SecondAttemptRecovery,
    type Dzen1045SecondAttemptDraftProof,
    type Dzen1045SecondAttemptInspection,
    type Dzen1045SecondAttemptPublication
} from '../dzen_task1045_second_attempt_contract';

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

export type EditorPackage = {
    publicationId: string;
    coverId: string;
    title: string;
    bodyMatches: boolean;
    coverSha256: string;
};

export async function readDzen1045EditorPackage(page: Page, publicationId: string, acceptedBody: string): Promise<EditorPackage> {
    const detailPath = `/editor-api/v2/publisher/${DZEN1045.publisherId}/publication/${publicationId}`;
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === detailPath
        && response.status() === 200, { timeout: 30_000 });
    await page.goto(`https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/${publicationId}/edit`,
        { waitUntil: 'networkidle2', timeout: 30_000 });
    const native = record(await (await pending).json());
    const publications = Array.isArray(native.publications) ? native.publications : [];
    const publication = record(publications.find(item => String(record(item).id || '') === publicationId));
    const image = record(record(record(publication.content).preview).image);
    const coverId = typeof image.id === 'string' ? image.id : String(image.id || '');
    const [title, body] = await Promise.all([
        page.$eval(DZEN_EDITOR_SELECTORS.articleTitle, element => (element as HTMLElement).innerText),
        page.$eval(DZEN_EDITOR_SELECTORS.articleBody, element => (element as HTMLElement).innerText)
    ]);
    const coverSha256 = coverId
        ? createHash('sha256').update(await readDzen1045CoverBytes(publicationId, coverId)).digest('hex') : '';
    return { publicationId, coverId, title,
        bodyMatches: normalizeDzen1045Body(body) === normalizeDzen1045Body(acceptedBody), coverSha256 };
}

export function dzen1045PackageMatches(value: EditorPackage): boolean {
    return value.title === DZEN1045.publicTitle && value.bodyMatches
        && value.coverSha256 === DZEN1045.assetSha;
}

export async function verifyDzen1045PublicBody(page: Page, url: string, acceptedBody: string): Promise<boolean> {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    return page.evaluate(body => {
        const normalize = (value: string) => value.normalize('NFKC').replace(/^#{1,6}\s+/gm, '')
            .replace(/^[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
        return normalize(document.body.innerText).includes(normalize(body));
    }, acceptedBody);
}

export async function inspectDzen1045SecondAttempt(page: Page, acceptedBody: string): Promise<Dzen1045SecondAttemptInspection> {
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    const published = await enumerateDzen1045Studio(page, listUrl, 'published');
    const publishedMatches = published.publications.filter(item => item.state === 'published'
        && item.title === DZEN1045.publicTitle && item.provider_object_id);
    if (!published.coverageComplete) throw new Error('[DZEN1045_SECOND_ATTEMPT_COVERAGE_INCOMPLETE]');
    if (publishedMatches.length === 1) {
        const match = publishedMatches[0];
        const editorPackage = await readDzen1045EditorPackage(page, match.provider_object_id!, acceptedBody);
        const publicBodyMatches = Boolean(match.public_url)
            && await verifyDzen1045PublicBody(page, match.public_url!, acceptedBody);
        if (dzen1045PackageMatches(editorPackage) && match.public_url && match.published_at && publicBodyMatches) {
            return { kind: 'exact_published', publication: {
                public_url: match.public_url, provider_object_id: match.provider_object_id!,
                published_at: match.published_at, public_body_matches: true, public_asset_matches: true,
                checked_at: new Date().toISOString()
            } };
        }
    }
    if (publishedMatches.length > 0) return { kind: 'no_exact_match', diagnostics: {
        publishedMatches: publishedMatches.length, draftObjects: 0, exactDraftMatches: 0,
        bodyMismatches: 0, coverMismatches: 0, titleMismatches: 0
    } };

    const drafts = await enumerateDzen1045Studio(page, listUrl, 'draft');
    if (!drafts.coverageComplete) throw new Error('[DZEN1045_SECOND_ATTEMPT_COVERAGE_INCOMPLETE]');
    const candidates = drafts.publications.filter(item => item.state === 'draft' && item.provider_object_id);
    const exact: EditorPackage[] = [];
    const diagnostics = { publishedMatches: 0, draftObjects: candidates.length, exactDraftMatches: 0,
        bodyMismatches: 0, coverMismatches: 0, titleMismatches: 0 };
    for (const candidate of candidates) {
        const observed = await readDzen1045EditorPackage(page, candidate.provider_object_id!, acceptedBody);
        if (observed.title !== DZEN1045.publicTitle) diagnostics.titleMismatches += 1;
        else if (!observed.bodyMatches) diagnostics.bodyMismatches += 1;
        else if (observed.coverSha256 !== DZEN1045.assetSha) diagnostics.coverMismatches += 1;
        else exact.push(observed);
    }
    diagnostics.exactDraftMatches = exact.length;
    if (exact.length !== 1) return { kind: 'no_exact_match', diagnostics };
    const selected = await readDzen1045EditorPackage(page, exact[0].publicationId, acceptedBody);
    if (!dzen1045PackageMatches(selected)) return { kind: 'no_exact_match', diagnostics: {
        ...diagnostics, exactDraftMatches: 0
    } };
    const header = await page.waitForSelector(DZEN_EDITOR_SELECTORS.articlePublish, { visible: true, timeout: 15_000 });
    if (!header) throw new Error('[DZEN1045_SECOND_ATTEMPT_HEADER_CONTROL_MISSING]');
    await header.click();
    await resolveDzenPublicationConfirm(page, DZEN_EDITOR_SELECTORS.publicationConfirm);
    const finalControlReady = true;
    const proof: Dzen1045SecondAttemptDraftProof = {
        draftId: selected.publicationId, coverId: selected.coverId, title: selected.title,
        bodySha256: DZEN1045.bodySha, coverSha256: selected.coverSha256,
        publishedMatches: 0, publishedCoverageComplete: true, draftMatches: 1,
        draftCoverageComplete: true, finalControlReady
    };
    return { kind: 'exact_draft', proof };
}

/** Reconcile or final-click only the exact draft produced by task1045's second bounded attempt. */
export async function recoverDzen1045SecondAttemptInBrowser(page: Page, acceptedBody: string,
    args: { confirm: boolean; idempotencyKey: string },
    claim: (proof: Dzen1045SecondAttemptDraftProof) => Promise<boolean>) {
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    let selectedDraftId = '';
    return runDzen1045SecondAttemptRecovery(args, {
        inspect: async () => {
            const inspection = await inspectDzen1045SecondAttempt(page, acceptedBody);
            if (inspection.kind === 'exact_draft') selectedDraftId = inspection.proof.draftId;
            return inspection;
        },
        claim,
        submit: async proof => {
            if (!selectedDraftId || proof.draftId !== selectedDraftId) {
                throw new Error('[DZEN1045_SECOND_ATTEMPT_DRAFT_CHANGED]');
            }
            await clickDzenPublicationConfirm(page, DZEN_EDITOR_SELECTORS.publicationConfirm);
            await new Promise(resolve => setTimeout(resolve, 1500));
            const published = await enumerateDzen1045Studio(page, listUrl, 'published');
            const match = published.publications.find(item => item.state === 'published'
                && item.provider_object_id === proof.draftId && item.title === DZEN1045.publicTitle);
            if (!published.coverageComplete || !match?.public_url || !match.published_at
                || !await verifyDzen1045PublicBody(page, match.public_url, acceptedBody)) {
                throw new Error('[DZEN1045_SECOND_ATTEMPT_SUBMIT_UNCERTAIN] Exact public object not confirmed');
            }
            const result: Dzen1045SecondAttemptPublication = {
                public_url: match.public_url, provider_object_id: proof.draftId,
                published_at: match.published_at, public_body_matches: true, public_asset_matches: true,
                checked_at: new Date().toISOString()
            };
            return result;
        }
    });
}
