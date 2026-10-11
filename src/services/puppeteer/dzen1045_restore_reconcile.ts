import type { Page } from 'puppeteer';
import { DZEN1045 } from '../dzen_task1045_resume_contract';
import type { Dzen1045RestoreReadOnlyInspection } from '../dzen_task1045_restore_reconcile_contract';
import { enumerateDzen1045Studio } from './dzen1045_existing_draft';
import { dzen1045PackageMatches, readDzen1045EditorPackage,
    verifyDzen1045PublicBody, type EditorPackage } from './dzen1045_second_attempt';

/** Exhaustive authenticated GET/readback only. Never opens a publish dialog or invokes a write control. */
export async function inspectDzen1045RestoreIncident(page: Page,
    acceptedBody: string, ports = {
        enumerate: enumerateDzen1045Studio,
        readPackage: readDzen1045EditorPackage,
        verifyPublicBody: verifyDzen1045PublicBody
    }): Promise<Dzen1045RestoreReadOnlyInspection> {
    const listUrl = `https://dzen.ru/profile/editor/id/${DZEN1045.publisherId}/publications`;
    const published = await ports.enumerate(page, listUrl, 'published');
    const drafts = await ports.enumerate(page, listUrl, 'draft');
    if (!published.coverageComplete || !drafts.coverageComplete) {
        throw new Error('[DZEN1045_RESTORE_RECONCILE_COVERAGE_INCOMPLETE]');
    }
    const publishedCandidates = published.publications.filter(item => item.state === 'published'
        && item.title === DZEN1045.publicTitle && item.provider_object_id);
    const exactPublished: Array<{ observed: EditorPackage; public_url: string;
        published_at: string; provider_object_id: string }> = [];
    let publishedBodyMismatches = 0; let publishedCoverMismatches = 0; let publishedIdentityGaps = 0;
    for (const candidate of publishedCandidates) {
        const observed = await ports.readPackage(page, candidate.provider_object_id!, acceptedBody);
        if (!observed.bodyMatches) { publishedBodyMismatches += 1; continue; }
        if (observed.coverSha256 !== DZEN1045.assetSha) { publishedCoverMismatches += 1; continue; }
        if (!candidate.public_url || !candidate.published_at
            || !await ports.verifyPublicBody(page, candidate.public_url, acceptedBody)) {
            publishedIdentityGaps += 1; continue;
        }
        exactPublished.push({ observed, public_url: candidate.public_url,
            published_at: candidate.published_at, provider_object_id: candidate.provider_object_id! });
    }
    const draftCandidates = drafts.publications.filter(item => item.state === 'draft' && item.provider_object_id);
    const exactDrafts: EditorPackage[] = [];
    let draftTitleMismatches = 0; let draftBodyMismatches = 0; let draftCoverMismatches = 0;
    for (const candidate of draftCandidates) {
        const observed = await ports.readPackage(page, candidate.provider_object_id!, acceptedBody);
        if (observed.title !== DZEN1045.publicTitle) draftTitleMismatches += 1;
        else if (!observed.bodyMatches) draftBodyMismatches += 1;
        else if (observed.coverSha256 !== DZEN1045.assetSha) draftCoverMismatches += 1;
        else if (dzen1045PackageMatches(observed)) exactDrafts.push(observed);
    }
    const evidence = { provider_writes: 0, publish_controls_clicked: 0,
        published_coverage_complete: true, draft_coverage_complete: true,
        published_objects: published.publications.length, draft_objects: drafts.publications.length,
        inspected_published_ids: publishedCandidates.map(item => item.provider_object_id).slice(0, 10),
        inspected_draft_ids: draftCandidates.map(item => item.provider_object_id).slice(0, 10),
        list_url: listUrl, checked_at: new Date().toISOString() };
    if (publishedCandidates.length === 1 && exactPublished.length === 1 && exactDrafts.length === 0) {
        const match = exactPublished[0];
        return { kind: 'exact_published', publication: { public_url: match.public_url,
            provider_object_id: match.provider_object_id, published_at: match.published_at,
            public_body_matches: true, public_asset_matches: true, checked_at: evidence.checked_at }, evidence };
    }
    if (publishedCandidates.length === 0 && exactDrafts.length === 1) {
        const draft = exactDrafts[0];
        return { kind: 'sole_exact_draft', draft: { draftId: draft.publicationId,
            coverId: draft.coverId, title: draft.title, bodySha256: DZEN1045.bodySha,
            coverSha256: DZEN1045.assetSha }, evidence };
    }
    return { kind: 'no_exact_match', diagnostics: { publishedTitleCandidates: publishedCandidates.length,
        exactPublishedMatches: exactPublished.length, publishedBodyMismatches, publishedCoverMismatches,
        publishedIdentityGaps, draftCandidates: draftCandidates.length, exactDraftMatches: exactDrafts.length,
        draftTitleMismatches, draftBodyMismatches, draftCoverMismatches }, evidence };
}
