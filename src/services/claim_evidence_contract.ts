export const CLAIM_EVIDENCE_CONTRACT_VERSION = 1;

export const CLAIM_STAGES = ['idea', 'hypothesis', 'experiment', 'verified_result'] as const;
export type ClaimStage = typeof CLAIM_STAGES[number];

export const EVIDENCE_STATUSES = ['not_required', 'missing', 'attached', 'verified', 'invalid'] as const;
export type EvidenceStatus = typeof EVIDENCE_STATUSES[number];

export const EVIDENCE_TYPES = [
    'observable_product', 'reproducible_test', 'real_screenshot_or_recording',
    'metric', 'commit_or_release', 'publication_fact', 'other_verifiable_artifact',
    'mockup', 'prototype', 'presentation', 'ai_generated_demo'
] as const;
export type EvidenceType = typeof EVIDENCE_TYPES[number];

export type EvidenceRef = {
    type: EvidenceType;
    ref: string;
    contentRevision: number;
    claim?: string;
    metric?: { period?: string; baseline?: string | number; comparator?: string | number };
};

export type ClaimEvidenceInput = {
    claimStage: ClaimStage;
    headlineStage?: ClaimStage;
    evidenceStatus: EvidenceStatus;
    evidenceRefs: EvidenceRef[];
};

export type ClaimEvidenceAssessment = {
    contract_version: 1;
    claim_stage: ClaimStage;
    headline_stage: ClaimStage | null;
    evidence_status: EvidenceStatus;
    evidence_refs: EvidenceRef[];
    content_revision: number;
    alignment_status: 'aligned' | 'revise';
    issue_codes: string[];
};

const NON_PRODUCTION_TYPES = new Set<EvidenceType>([
    'mockup', 'prototype', 'presentation', 'ai_generated_demo'
]);

const STAGE_STRENGTH: Record<ClaimStage, number> = {
    idea: 0,
    hypothesis: 1,
    experiment: 2,
    verified_result: 3
};

/**
 * Evaluates a reviewer-supplied structured assessment without model calls or writes.
 * The caller remains responsible for verifying that referenced artifacts are real.
 */
export function evaluateClaimEvidence(
    input: ClaimEvidenceInput,
    contentRevision: number
): ClaimEvidenceAssessment {
    const issueCodes = new Set<string>();
    const evidenceRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [];

    if (input.headlineStage && STAGE_STRENGTH[input.headlineStage] > STAGE_STRENGTH[input.claimStage]) {
        issueCodes.add('HEADLINE_EXCEEDS_EVIDENCE');
    }

    if (evidenceRefs.some(ref => ref.contentRevision !== contentRevision)) {
        issueCodes.add('STALE_CLAIM_EVIDENCE');
    }

    const nonProductionRefs = evidenceRefs.filter(ref => NON_PRODUCTION_TYPES.has(ref.type));
    if (input.claimStage === 'verified_result' && nonProductionRefs.length > 0) {
        issueCodes.add('NON_PRODUCTION_ARTIFACT');
    }

    const productionRefs = evidenceRefs.filter(ref => !NON_PRODUCTION_TYPES.has(ref.type)
        && ref.contentRevision === contentRevision);
    if (input.claimStage === 'verified_result'
        && (input.evidenceStatus !== 'verified' || productionRefs.length === 0)) {
        issueCodes.add('VERIFIED_RESULT_EVIDENCE_REQUIRED');
    }

    if (productionRefs.some(ref => ref.type === 'metric'
        && (!ref.metric?.period?.trim()
            || (ref.metric.baseline == null && ref.metric.comparator == null)))) {
        issueCodes.add('INCOMPLETE_METRIC_EVIDENCE');
    }

    const issue_codes = [...issueCodes];
    return {
        contract_version: CLAIM_EVIDENCE_CONTRACT_VERSION,
        claim_stage: input.claimStage,
        headline_stage: input.headlineStage || null,
        evidence_status: input.evidenceStatus,
        evidence_refs: evidenceRefs,
        content_revision: contentRevision,
        alignment_status: issue_codes.length === 0 ? 'aligned' : 'revise',
        issue_codes
    };
}
