import type { Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import { DZEN1045_PHASE_A_V2_RECONCILE,
    type Dzen1045PhaseAV2ReconcileInspection } from '../dzen_task1045_phase_a_v2_reconcile_contract';
import { enumerateDzen1045Studio } from './dzen1045_existing_draft';
import { dzen1045PackageMatches, readDzen1045EditorPackage,
    verifyDzen1045PublicBody } from './dzen1045_second_attempt';

export function isDzen1045ReconcileWriteMethod(method: string): boolean {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

/** Exact read-only provider reconciliation. Every browser mutation request is aborted. */
export async function inspectDzen1045PhaseAV2Incident(page: Page, acceptedBody: string,
    ports = { enumerate: enumerateDzen1045Studio, readPackage: readDzen1045EditorPackage,
        verifyPublicBody: verifyDzen1045PublicBody }): Promise<Dzen1045PhaseAV2ReconcileInspection> {
    const blockedWrites: Array<{ method: string; host: string; path: string }> = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
        const method = request.method().toUpperCase();
        let url: URL; try { url = new URL(request.url()); } catch { void request.continue(); return; }
        if (isDzen1045ReconcileWriteMethod(method)) {
            if (blockedWrites.length < 100) blockedWrites.push({ method, host: url.hostname, path: url.pathname });
            void request.abort(); return;
        }
        void request.continue();
    });
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    const published = await ports.enumerate(page, listUrl, 'published');
    const drafts = await ports.enumerate(page, listUrl, 'draft');
    if (!published.coverageComplete || !drafts.coverageComplete) {
        throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_COVERAGE_INCOMPLETE]');
    }
    const providerId = DZEN1045_PHASE_A_V2_RECONCILE.providerId;
    const publishedObject = published.publications.find(item => item.provider_object_id === providerId);
    const draftObject = drafts.publications.find(item => item.provider_object_id === providerId);
    let observed: Awaited<ReturnType<typeof readDzen1045EditorPackage>> | null = null;
    let detailError: string | null = null;
    try { observed = await ports.readPackage(page, providerId, acceptedBody); }
    catch (error: unknown) { detailError = error instanceof Error ? error.message : String(error); }
    const evidence = { provider_writes: 0, blocked_writes: blockedWrites,
        published_coverage_complete: true, draft_coverage_complete: true,
        published_objects: published.publications.length, draft_objects: drafts.publications.length,
        target_provider_id: providerId, target_numeric_provider_id: DZEN1045_PHASE_A_V2_RECONCILE.numericProviderId,
        target_image_id: DZEN1045_PHASE_A_V2_RECONCILE.imageId,
        target_in_published: Boolean(publishedObject), target_in_drafts: Boolean(draftObject),
        detail_get_attempted: true, detail_error: detailError,
        checked_at: new Date().toISOString() };
    if (publishedObject && !draftObject && observed && dzen1045PackageMatches(observed)
        && publishedObject.public_url && publishedObject.published_at
        && await ports.verifyPublicBody(page, publishedObject.public_url, acceptedBody)) {
        return { kind: 'exact_published', publication: { public_url: publishedObject.public_url,
            provider_object_id: providerId, published_at: publishedObject.published_at,
            public_body_matches: true, public_asset_matches: true, checked_at: evidence.checked_at }, evidence };
    }
    if (draftObject && !publishedObject && observed && dzen1045PackageMatches(observed)) {
        return { kind: 'exact_durable_draft', draft: { draftId: providerId, coverId: observed.coverId,
            title: DZEN1045.publicTitle, bodySha256: DZEN1045.bodySha, coverSha256: DZEN1045.assetSha,
            checkedAt: evidence.checked_at }, evidence };
    }
    return { kind: 'no_exact_match', diagnostics: { target_state: publishedObject && draftObject
        ? 'ambiguous' : publishedObject ? 'published_mismatch' : draftObject ? 'draft_mismatch' : 'missing',
    observed: observed ? { publicationId: observed.publicationId, coverId: observed.coverId,
        title: observed.title, bodyMatches: observed.bodyMatches, coverSha256: observed.coverSha256 } : null }, evidence };
}
