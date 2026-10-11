import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_PHASE_A_V2 } from './dzen_task1045_phase_a_v2_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

export const DZEN1045_PHASE_A_V2_RECONCILE = {
    command: 'ba_reconcile_dzen_task1045_phase_a_v2_incident',
    sourceKey: DZEN1045_PHASE_A_V2.idempotencyKey,
    failedAt: '2026-10-11T19:04:04.486Z',
    providerId: '6acbdd8a8645cd779010ee4e',
    numericProviderId: '1657986042461850919',
    imageId: '6acbdd93f60ad85b6bcaf939',
    idempotencyKey: 'dzen-p10-1045-r4-asset129-phase-a-v2-reconcile-20261011-01'
} as const;

export type Dzen1045PhaseAV2ReconcileInspection =
    | { kind: 'exact_durable_draft'; draft: { draftId: typeof DZEN1045_PHASE_A_V2_RECONCILE.providerId;
        coverId: string; title: typeof DZEN1045.publicTitle; bodySha256: typeof DZEN1045.bodySha;
        coverSha256: typeof DZEN1045.assetSha; checkedAt: string }; evidence: Record<string, unknown> }
    | { kind: 'exact_published'; publication: Dzen1045SecondAttemptPublication;
        evidence: Record<string, unknown> }
    | { kind: 'no_exact_match'; diagnostics: Record<string, unknown>; evidence: Record<string, unknown> };

export function assertDzen1045PhaseAV2Incident(delivery: Record<string, unknown>): void {
    if (delivery.state !== 'draft_phase_a_v2_uncertain'
        || delivery.phase_a_v2_idempotency_key !== DZEN1045_PHASE_A_V2_RECONCILE.sourceKey
        || delivery.phase_a_v2_failed_at !== DZEN1045_PHASE_A_V2_RECONCILE.failedAt
        || delivery.final_submit_allowed !== false || delivery.final_submit_count !== 0
        || delivery.retry_via_api !== false) {
        throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_INCIDENT_MISMATCH]');
    }
}

/** Provider inspection is always read-only; confirm only persists an exact observed result locally. */
export async function runDzen1045PhaseAV2Reconcile<TDraft, TPublished>(args: {
    confirm: boolean; idempotencyKey: string;
}, ports: {
    inspect(): Promise<Dzen1045PhaseAV2ReconcileInspection>;
    applyDraft(draft: Extract<Dzen1045PhaseAV2ReconcileInspection,
        { kind: 'exact_durable_draft' }>['draft']): Promise<TDraft>;
    applyPublished(publication: Dzen1045SecondAttemptPublication): Promise<TPublished>;
}) {
    if (args.idempotencyKey !== DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey) {
        throw new Error('[DZEN1045_PHASE_A_V2_RECONCILE_KEY_REQUIRED]');
    }
    const inspection = await ports.inspect();
    if (!args.confirm) return { mode: 'preview' as const, inspection };
    if (inspection.kind === 'exact_durable_draft') return { mode: 'draft_reconciled' as const,
        inspection, result: await ports.applyDraft(inspection.draft) };
    if (inspection.kind === 'exact_published') return { mode: 'published_reconciled' as const,
        inspection, result: await ports.applyPublished(inspection.publication) };
    return { mode: 'evidence_only' as const, inspection };
}
