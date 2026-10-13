type Input = { ready: boolean; hasSession: boolean; hasChannel: boolean;
    proof: unknown; inventoryRequired: boolean; now: number };
function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

/** Diagnostic only. Never performs provider reads or grants execution authority. */
export function describeDzenStoredReadiness(input: Input) {
    const blockers: string[] = [];
    if (!input.ready) {
        if (!input.hasSession) blockers.push('SESSION_NOT_CONFIGURED');
        if (!input.hasChannel) blockers.push('CHANNEL_NOT_CONFIGURED');
        const proof = record(input.proof);
        if (!proof) blockers.push('PREFLIGHT_PROOF_MISSING');
        else {
            if (proof.authenticated !== true) blockers.push('PREFLIGHT_AUTH_NOT_VERIFIED');
            if (proof.editor_available !== true) blockers.push('PREFLIGHT_EDITOR_NOT_VERIFIED');
            const checked = typeof proof.checked_at === 'string' ? Date.parse(proof.checked_at) : NaN;
            if (!Number.isFinite(checked)) blockers.push('PREFLIGHT_PROOF_TIME_INVALID');
            else if (input.now - checked >= 15 * 60_000) blockers.push('PREFLIGHT_PROOF_EXPIRED');
            const inventory = record(proof.inventory);
            if (input.inventoryRequired && (inventory?.classification !== 'absent' || inventory.coverage_complete !== true)) {
                blockers.push('INVENTORY_ABSENCE_NOT_VERIFIED');
            }
            if (!blockers.length) blockers.push('PREFLIGHT_PACKAGE_BINDING_MISMATCH');
        }
    }
    return { basis: 'stored_preflight_proof' as const, blockers };
}
