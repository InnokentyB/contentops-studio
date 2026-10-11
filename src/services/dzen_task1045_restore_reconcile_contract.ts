import { DZEN1045 } from './dzen_task1045_resume_contract';
import { DZEN1045_ZERO_RESTORE } from './dzen_task1045_zero_restore_contract';
import type { Dzen1045SecondAttemptPublication } from './dzen_task1045_second_attempt_contract';

export const DZEN1045_RESTORE_RECONCILE = {
    command: 'ba_reconcile_dzen_task1045_zero_restore_incident',
    restoreKey: DZEN1045_ZERO_RESTORE.idempotencyKey,
    failedAt: '2026-10-11T18:16:19.612Z',
    idempotencyKey: 'dzen-p10-1045-r4-asset129-zero-restore-reconcile-20261011-01'
} as const;

export type Dzen1045RestoreReadOnlyInspection =
    | { kind: 'exact_published'; publication: Dzen1045SecondAttemptPublication; evidence: Record<string, unknown> }
    | { kind: 'sole_exact_draft'; draft: { draftId: string; coverId: string; title: string;
        bodySha256: typeof DZEN1045.bodySha; coverSha256: typeof DZEN1045.assetSha };
        evidence: Record<string, unknown> }
    | { kind: 'no_exact_match'; diagnostics: Record<string, unknown>; evidence: Record<string, unknown> };

export function assertDzen1045RestoreIncident(delivery: Record<string, unknown>): void {
    if (delivery.state !== 'zero_inventory_restore_uncertain'
        || delivery.restore_idempotency_key !== DZEN1045_RESTORE_RECONCILE.restoreKey
        || delivery.failed_at !== DZEN1045_RESTORE_RECONCILE.failedAt
        || delivery.provider_create_may_have_occurred !== true
        || delivery.final_submit_may_have_occurred !== true
        || delivery.retry_via_api !== false) {
        throw new Error('[DZEN1045_RESTORE_RECONCILE_INCIDENT_MISMATCH]');
    }
}

/** Preview is provider-read-only; confirm can only persist an already exact public identity. */
export async function runDzen1045RestoreReconcile<T>(args: { confirm: boolean; idempotencyKey: string }, ports: {
    inspect(): Promise<Dzen1045RestoreReadOnlyInspection>;
    reconcile(publication: Dzen1045SecondAttemptPublication): Promise<T>;
}): Promise<{ mode: 'preview'; inspection: Dzen1045RestoreReadOnlyInspection }
    | { mode: 'reconciled'; publication: Dzen1045SecondAttemptPublication; result: T }> {
    if (args.idempotencyKey !== DZEN1045_RESTORE_RECONCILE.idempotencyKey) {
        throw new Error('[DZEN1045_RESTORE_RECONCILE_KEY_REQUIRED]');
    }
    const inspection = await ports.inspect();
    if (!args.confirm) return { mode: 'preview', inspection };
    if (inspection.kind !== 'exact_published') {
        throw new Error(`[DZEN1045_RESTORE_RECONCILE_NOT_PUBLIC] ${inspection.kind}`);
    }
    return { mode: 'reconciled', publication: inspection.publication,
        result: await ports.reconcile(inspection.publication) };
}
