import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_RESTORE_RECONCILE, type Dzen1045RestoreReadOnlyInspection } from './dzen_task1045_restore_reconcile_contract';

export const DZEN1045_PHASE_A = {
    command: 'ba_create_dzen_task1045_durable_draft_phase_a',
    idempotencyKey: 'dzen-p10-1045-r4-asset129-draft-phase-a-20261011-01',
    sourceRestoreKey: DZEN1045_RESTORE_RECONCILE.restoreKey,
    sourceFailedAt: DZEN1045_RESTORE_RECONCILE.failedAt
} as const;

export type Dzen1045DurableDraftProof = { draftId: string; coverId: string;
    title: typeof DZEN1045.publicTitle; bodySha256: typeof DZEN1045.bodySha;
    coverSha256: typeof DZEN1045.assetSha; publishedCoverageComplete: true;
    draftCoverageComplete: true; exactPublishedMatches: 0; exactDraftMatches: 1;
    persistenceTrigger: 'semantic_save_control' | 'editor_blur_then_studio_navigation';
    providerTrace: Array<{ method: string; path: string; status: number }>;
    provenAt: string };

export function assertDzen1045PhaseAZero(inspection: Dzen1045RestoreReadOnlyInspection): void {
    if (inspection.kind !== 'no_exact_match') throw new Error('[DZEN1045_PHASE_A_INVENTORY_NOT_ZERO]');
    const diagnostics = inspection.diagnostics;
    if (diagnostics.publishedTitleCandidates !== 0 || diagnostics.exactPublishedMatches !== 0
        || diagnostics.exactDraftMatches !== 0 || diagnostics.publishedBodyMismatches !== 0
        || diagnostics.publishedCoverMismatches !== 0 || diagnostics.publishedIdentityGaps !== 0
        || diagnostics.draftBodyMismatches !== 0 || diagnostics.draftCoverMismatches !== 0) {
        throw new Error('[DZEN1045_PHASE_A_INVENTORY_NOT_ZERO]');
    }
}
export function assertDzen1045DurableDraftProof(proof: Dzen1045DurableDraftProof): void {
    if (!/^[a-f0-9]{16,64}$/.test(proof.draftId) || !proof.coverId
        || proof.title !== DZEN1045.publicTitle || proof.bodySha256 !== DZEN1045.bodySha
        || proof.coverSha256 !== DZEN1045.assetSha || !proof.publishedCoverageComplete
        || !proof.draftCoverageComplete || proof.exactPublishedMatches !== 0
        || proof.exactDraftMatches !== 1 || !proof.provenAt) {
        throw new Error('[DZEN1045_PHASE_A_DRAFT_PROOF_INVALID]');
    }
}

/** Phase A has no submit port by design. */
export async function runDzen1045PhaseA(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen1045RestoreReadOnlyInspection>;
    claim(inspection: Dzen1045RestoreReadOnlyInspection): Promise<boolean>;
    createAndPersist(): Promise<Dzen1045DurableDraftProof>;
}) {
    if (args.idempotencyKey !== DZEN1045_PHASE_A.idempotencyKey) throw new Error('[DZEN1045_PHASE_A_KEY_REQUIRED]');
    const inspection = await ports.inspect();
    assertDzen1045PhaseAZero(inspection);
    if (!args.confirm) return { mode: 'preview' as const, inspection };
    if (!await ports.claim(inspection)) throw new Error('[DZEN1045_PHASE_A_ALREADY_CLAIMED]');
    const proof = await ports.createAndPersist();
    assertDzen1045DurableDraftProof(proof);
    return { mode: 'draft_proven' as const, proof };
}
