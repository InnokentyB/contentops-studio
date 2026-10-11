import { DZEN1045 } from './dzen_task1045_resume_contract';

export const DZEN1045_SECOND_ATTEMPT = {
    attemptKey: DZEN1045.retryKey,
    failedAt: '2026-10-10T22:38:32.847Z',
    errorCode: 'DZEN_FINAL_SUBMIT_NOT_ATTEMPTED',
    resumeKey: 'dzen-p10-1045-r4-asset129-second-attempt-draft-resume-20261011-01',
    command: 'ba_reconcile_or_resume_dzen_task1045_second_attempt'
} as const;

export type Dzen1045SecondAttemptDraftProof = {
    draftId: string;
    coverId: string;
    title: string;
    bodySha256: string;
    coverSha256: string;
    publishedMatches: number;
    publishedCoverageComplete: boolean;
    draftMatches: number;
    draftCoverageComplete: boolean;
    finalControlReady: boolean;
};

export type Dzen1045SecondAttemptPublication = {
    public_url: string;
    provider_object_id: string;
    published_at: string;
    public_body_matches: true;
    public_asset_matches: true;
    checked_at: string;
};

export type Dzen1045SecondAttemptDiagnostics = {
    publishedMatches: number;
    draftObjects: number;
    exactDraftMatches: number;
    bodyMismatches: number;
    coverMismatches: number;
    titleMismatches: number;
};

export type Dzen1045SecondAttemptInspection =
    | { kind: 'exact_published'; publication: Dzen1045SecondAttemptPublication }
    | { kind: 'exact_draft'; proof: Dzen1045SecondAttemptDraftProof }
    | { kind: 'no_exact_match'; diagnostics: Dzen1045SecondAttemptDiagnostics };

function assertExactDraft(proof: Dzen1045SecondAttemptDraftProof): void {
    if (!/^[a-f0-9]{16,64}$/.test(proof.draftId) || !proof.coverId
        || proof.title !== DZEN1045.publicTitle || proof.bodySha256 !== DZEN1045.bodySha
        || proof.coverSha256 !== DZEN1045.assetSha || proof.publishedMatches !== 0
        || !proof.publishedCoverageComplete || proof.draftMatches !== 1
        || !proof.draftCoverageComplete || !proof.finalControlReady) {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_NOT_EXACT] Draft package or exhaustive coverage changed');
    }
}

function assertExactPublication(publication: Dzen1045SecondAttemptPublication): void {
    let url: URL;
    try { url = new URL(publication.public_url); } catch {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_NOT_EXACT] Invalid public URL');
    }
    if (!['dzen.ru', 'www.dzen.ru'].includes(url.hostname)
        || !publication.provider_object_id || !publication.published_at
        || publication.public_body_matches !== true || publication.public_asset_matches !== true) {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_NOT_EXACT] Published identity or package changed');
    }
}

/** Orchestrate one bounded reconciliation or final click; never creates or rewrites a draft. */
export async function runDzen1045SecondAttemptRecovery<T extends Dzen1045SecondAttemptPublication>(
    args: { confirm: boolean; idempotencyKey: string },
    ports: {
        inspect(): Promise<Dzen1045SecondAttemptInspection>;
        claim(proof: Dzen1045SecondAttemptDraftProof): Promise<boolean>;
        submit(proof: Dzen1045SecondAttemptDraftProof): Promise<T>;
    }
): Promise<
    | { mode: 'preview'; inspection: Exclude<Dzen1045SecondAttemptInspection, { kind: 'no_exact_match' }> }
    | { mode: 'reconciled'; publication: Dzen1045SecondAttemptPublication }
    | { mode: 'submitted'; publication: T }
> {
    if (args.idempotencyKey !== DZEN1045_SECOND_ATTEMPT.resumeKey) {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_RESUME_KEY_REQUIRED]');
    }
    const inspection = await ports.inspect();
    if (inspection.kind === 'no_exact_match') {
        throw new Error(`[DZEN1045_SECOND_ATTEMPT_NOT_EXACT] ${JSON.stringify(inspection.diagnostics)}`);
    }
    if (inspection.kind === 'exact_published') assertExactPublication(inspection.publication);
    else assertExactDraft(inspection.proof);
    if (!args.confirm) return { mode: 'preview', inspection };
    if (inspection.kind === 'exact_published') {
        return { mode: 'reconciled', publication: inspection.publication };
    }
    if (!await ports.claim(inspection.proof)) {
        throw new Error('[DZEN1045_SECOND_ATTEMPT_ALREADY_CLAIMED]');
    }
    return { mode: 'submitted', publication: await ports.submit(inspection.proof) };
}
