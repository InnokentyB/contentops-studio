export const DZEN1045_PHASE_A_PROBE = {
    tool: 'ba_probe_dzen_task1045_phase_a_creation_contract',
    menuTool: 'ba_probe_dzen_task1045_phase_a_creation_menu',
    phaseAKey: 'dzen-p10-1045-r4-asset129-draft-phase-a-20261011-01',
    failedAt: '2026-10-11T18:37:03.304Z'
} as const;

export function assertDzen1045PhaseAProbeIncident(delivery: Record<string, unknown>): void {
    if (delivery.state !== 'draft_phase_a_uncertain'
        || delivery.phase_a_idempotency_key !== DZEN1045_PHASE_A_PROBE.phaseAKey
        || delivery.failed_at !== DZEN1045_PHASE_A_PROBE.failedAt
        || delivery.final_submit_allowed !== false || delivery.final_submit_count !== 0
        || delivery.retry_via_api !== false) throw new Error('[DZEN1045_PHASE_A_PROBE_INCIDENT_MISMATCH]');
}
export function isDzenProbeWriteMethod(method: string): boolean {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}
