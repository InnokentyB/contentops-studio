import { DZEN1045_PHASE_B } from './dzen_task1045_phase_b_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

export const DZEN1045_PHASE_B_RECONCILE = {
    command: 'ba_reconcile_dzen_task1045_phase_b_incident',
    sourceKey: DZEN1045_PHASE_B.idempotencyKey,
    failedAt: '2026-10-11T19:28:25.918Z',
    providerId: DZEN1045_PHASE_B.providerId,
    idempotencyKey: 'dzen-p10-1045-r4-asset129-phase-b-reconcile-20261011-01'
} as const;
export const DZEN1045_PHASE_B_DIALOG_PROBE = {
    tool: 'ba_probe_dzen_task1045_phase_b_dialog_contract',
    idempotencyKey: 'dzen-p10-1045-r4-asset129-phase-b-dialog-probe-20261011-01',
    sourceReconcileKey: DZEN1045_PHASE_B_RECONCILE.idempotencyKey,
    recordedAt: '2026-10-11T19:38:23.170Z'
} as const;
export type Dzen1045PhaseBInspection =
    | { kind: 'exact_public'; publication: Dzen1045SecondAttemptPublication; evidence: Record<string, unknown> }
    | { kind: 'exact_draft' | 'ambiguous'; evidence: Record<string, unknown> };

export function assertDzen1045PhaseBIncident(delivery: Record<string, unknown>): void {
    if (delivery.state !== 'phase_b_uncertain'
        || delivery.phase_b_idempotency_key !== DZEN1045_PHASE_B_RECONCILE.sourceKey
        || delivery.phase_b_failed_at !== DZEN1045_PHASE_B_RECONCILE.failedAt
        || delivery.provider_object_id !== DZEN1045_PHASE_B_RECONCILE.providerId
        || delivery.final_submit_allowed !== false || delivery.final_submit_may_have_occurred !== true
        || delivery.retry_via_api !== false) throw new Error('[DZEN1045_PHASE_B_RECONCILE_INCIDENT_MISMATCH]');
}
export async function runDzen1045PhaseBReconcile<TPublic, TDraft>(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen1045PhaseBInspection>;
    record(publication: Dzen1045SecondAttemptPublication): Promise<TPublic>;
    recordNotAttempted(): Promise<TDraft>;
}) {
    if (args.idempotencyKey !== DZEN1045_PHASE_B_RECONCILE.idempotencyKey) {
        throw new Error('[DZEN1045_PHASE_B_RECONCILE_KEY_REQUIRED]');
    }
    const inspection = await ports.inspect();
    if (!args.confirm) return { mode: 'preview' as const, inspection };
    if (inspection.kind === 'exact_draft') return { mode: 'not_attempted_final' as const, inspection,
        result: await ports.recordNotAttempted() };
    if (inspection.kind !== 'exact_public') return { mode: 'evidence_only' as const, inspection };
    return { mode: 'reconciled' as const, inspection,
        result: await ports.record(inspection.publication) };
}
