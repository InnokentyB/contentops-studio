import type { Dzen1045SecondAttemptInspection } from './dzen_task1045_second_attempt_contract';

export const DZEN1045_ZERO_RESTORE = {
    command: 'ba_restore_dzen_task1045_after_zero_inventory',
    idempotencyKey: 'dzen-p10-1045-r4-asset129-zero-restore-20261011-01'
} as const;

export function assertDzen1045ZeroRelevantInventory(inspection: Dzen1045SecondAttemptInspection): void {
    if (inspection.kind !== 'no_exact_match'
        || inspection.diagnostics.publishedMatches !== 0
        || inspection.diagnostics.exactDraftMatches !== 0
        || inspection.diagnostics.bodyMismatches !== 0
        || inspection.diagnostics.coverMismatches !== 0) {
        throw new Error(`[DZEN1045_RESTORE_AMBIGUOUS] ${JSON.stringify(inspection)}`);
    }
}

export async function runDzen1045ZeroRestore<T>(
    args: { confirm: boolean; idempotencyKey: string },
    ports: {
        inspect(): Promise<Dzen1045SecondAttemptInspection>;
        claim(inspection: Dzen1045SecondAttemptInspection): Promise<boolean>;
        restore(): Promise<T>;
    }
): Promise<{ mode: 'preview'; inspection: Dzen1045SecondAttemptInspection }
    | { mode: 'restored'; result: T }> {
    if (args.idempotencyKey !== DZEN1045_ZERO_RESTORE.idempotencyKey) {
        throw new Error('[DZEN1045_ZERO_RESTORE_KEY_REQUIRED]');
    }
    const inspection = await ports.inspect();
    if (!args.confirm) return { mode: 'preview', inspection };
    if (!await ports.claim(inspection)) throw new Error('[DZEN1045_ZERO_RESTORE_ALREADY_CLAIMED]');
    return { mode: 'restored', result: await ports.restore() };
}
