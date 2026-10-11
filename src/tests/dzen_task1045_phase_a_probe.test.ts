import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDzen1045PhaseAProbeIncident, DZEN1045_PHASE_A_PROBE,
    isDzenProbeWriteMethod } from '../services/dzen_task1045_phase_a_probe_contract';

test('phase A probe binds the exact frozen incident', () => {
    assert.doesNotThrow(() => assertDzen1045PhaseAProbeIncident({ state: 'draft_phase_a_uncertain',
        phase_a_idempotency_key: DZEN1045_PHASE_A_PROBE.phaseAKey, failed_at: DZEN1045_PHASE_A_PROBE.failedAt,
        final_submit_allowed: false, final_submit_count: 0, retry_via_api: false }));
    assert.throws(() => assertDzen1045PhaseAProbeIncident({ state: 'draft_phase_a_uncertain',
        phase_a_idempotency_key: 'stale', failed_at: DZEN1045_PHASE_A_PROBE.failedAt,
        final_submit_allowed: false, final_submit_count: 0, retry_via_api: false }), /INCIDENT_MISMATCH/);
});
test('probe browser boundary blocks every provider mutation method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isDzenProbeWriteMethod(method), true);
    for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(isDzenProbeWriteMethod(method), false);
});
