import { DZEN1045 } from './dzen_task1045_resume_contract';
import { assertDzen1045PhaseAZero } from './dzen_task1045_phase_a_contract';
import type { Dzen1045RestoreReadOnlyInspection } from './dzen_task1045_restore_reconcile_contract';
import { DZEN1045_PHASE_A_PROBE } from './dzen_task1045_phase_a_probe_contract';

export const DZEN1045_PHASE_A_V2 = {
    command: 'ba_create_dzen_task1045_durable_draft_phase_a_v2',
    idempotencyKey: 'dzen-p10-1045-r4-asset129-draft-phase-a-v2-20261011-01',
    sourcePhaseAKey: DZEN1045_PHASE_A_PROBE.phaseAKey,
    sourceFailedAt: DZEN1045_PHASE_A_PROBE.failedAt
} as const;

export type Dzen1045ProviderTraceEntry = {
    event: 'request' | 'response'; method: string; path: string; stage: string;
    status?: number; ids?: string[];
};
export type Dzen1045DurableDraftProofV2 = {
    draftId: string; editorUrl: string; coverId: string; title: typeof DZEN1045.publicTitle;
    bodySha256: typeof DZEN1045.bodySha; coverSha256: typeof DZEN1045.assetSha;
    publishedCoverageComplete: true; draftCoverageComplete: true;
    exactPublishedMatches: 0; exactDraftMatches: 1;
    creationAcknowledged: true; persistenceAcknowledged: true;
    creationControlsClicked: 2; saveControlsClicked: 0 | 1; finalSubmitCount: 0;
    persistenceTrigger: 'semantic_save_control' | 'acknowledged_autosave_then_studio_navigation';
    providerTrace: Dzen1045ProviderTraceEntry[]; provenAt: string;
};

export function assertDzen1045PhaseAV2Proof(proof: Dzen1045DurableDraftProofV2): void {
    const acknowledged = (stages: string[]) => proof.providerTrace.some(item => item.event === 'response'
        && ['POST', 'PUT', 'PATCH'].includes(item.method) && stages.includes(item.stage)
        && typeof item.status === 'number' && item.status >= 200 && item.status < 300
        && (item.ids?.includes(proof.draftId) || item.path.includes(proof.draftId)));
    if (!/^[a-f0-9]{16,64}$/.test(proof.draftId) || !proof.coverId
        || !proof.editorUrl.includes(`/${proof.draftId}/edit`)
        || proof.title !== DZEN1045.publicTitle || proof.bodySha256 !== DZEN1045.bodySha
        || proof.coverSha256 !== DZEN1045.assetSha || !proof.publishedCoverageComplete
        || !proof.draftCoverageComplete || proof.exactPublishedMatches !== 0
        || proof.exactDraftMatches !== 1 || proof.creationAcknowledged !== true
        || proof.persistenceAcknowledged !== true || proof.creationControlsClicked !== 2
        || ![0, 1].includes(proof.saveControlsClicked) || proof.finalSubmitCount !== 0
        || !acknowledged(['article_option']) || !acknowledged(['fill', 'asset', 'blur', 'save'])
        || !proof.provenAt) {
        throw new Error('[DZEN1045_PHASE_A_V2_DRAFT_PROOF_INVALID]');
    }
}

/** V2 still has no final-submit port. */
export async function runDzen1045PhaseAV2(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen1045RestoreReadOnlyInspection>;
    claim(inspection: Dzen1045RestoreReadOnlyInspection): Promise<boolean>;
    createAndPersist(): Promise<Dzen1045DurableDraftProofV2>;
}) {
    if (args.idempotencyKey !== DZEN1045_PHASE_A_V2.idempotencyKey) {
        throw new Error('[DZEN1045_PHASE_A_V2_KEY_REQUIRED]');
    }
    const inspection = await ports.inspect();
    assertDzen1045PhaseAZero(inspection);
    if (!args.confirm) return { mode: 'preview' as const, inspection };
    if (!await ports.claim(inspection)) throw new Error('[DZEN1045_PHASE_A_V2_ALREADY_CLAIMED]');
    const proof = await ports.createAndPersist();
    assertDzen1045PhaseAV2Proof(proof);
    return { mode: 'draft_proven' as const, proof };
}
