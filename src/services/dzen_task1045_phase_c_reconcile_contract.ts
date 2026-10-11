import { DZEN1045_PHASE_C } from './dzen_task1045_phase_c_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

export const DZEN1045_PHASE_C_RECONCILE = {
    command: 'ba_reconcile_dzen_task1045_phase_c_incident',
    sourceKey: DZEN1045_PHASE_C.executeKey,
    semanticFingerprint: 'c6d5f195185f9d4affa636a985e32bdbbd5385acc6bab02ac807af6fe2e8bdd8',
    startedAt: '2026-10-11T21:06:09.778Z',
    failedAt: '2026-10-11T21:06:15.447Z',
    providerId: DZEN1045_PHASE_C.providerId,
    idempotencyKey: 'dzen-p10-1045-r4-asset129-phase-c-reconcile-20261011-01'
} as const;

export type Dzen1045PhaseCReconcileInspection =
    | { kind: 'exact_public'; publication: Dzen1045SecondAttemptPublication; evidence: Record<string, unknown> }
    | { kind: 'exact_draft' | 'ambiguous'; evidence: Record<string, unknown> };

export function assertDzen1045PhaseCIncident(delivery: Record<string, unknown>): void {
    if (delivery.state !== 'phase_c_uncertain'
        || delivery.phase_c_idempotency_key !== DZEN1045_PHASE_C_RECONCILE.sourceKey
        || delivery.phase_c_dialog_fingerprint !== DZEN1045_PHASE_C_RECONCILE.semanticFingerprint
        || delivery.phase_c_started_at !== DZEN1045_PHASE_C_RECONCILE.startedAt
        || delivery.phase_c_failed_at !== DZEN1045_PHASE_C_RECONCILE.failedAt
        || delivery.provider_object_id !== DZEN1045_PHASE_C_RECONCILE.providerId
        || delivery.final_submit_allowed !== false || delivery.final_submit_may_have_occurred !== true
        || delivery.final_submit_count_max !== 1 || delivery.retry_via_api !== false) {
        throw new Error('[DZEN1045_PHASE_C_RECONCILE_INCIDENT_MISMATCH]');
    }
}

export async function runDzen1045PhaseCReconcile<T>(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen1045PhaseCReconcileInspection>;
    record(publication: Dzen1045SecondAttemptPublication): Promise<T>;
}) {
    if (args.idempotencyKey !== DZEN1045_PHASE_C_RECONCILE.idempotencyKey) {
        throw new Error('[DZEN1045_PHASE_C_RECONCILE_KEY_REQUIRED]');
    }
    const inspection = await ports.inspect();
    if (!args.confirm) return { mode: 'preview' as const, inspection };
    if (inspection.kind === 'exact_draft') return { mode: 'exact_draft_no_public' as const, inspection };
    if (inspection.kind !== 'exact_public') return { mode: 'evidence_only' as const, inspection };
    return { mode: 'reconciled' as const, inspection, result: await ports.record(inspection.publication) };
}
