import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDzen1045PhaseCIncident, DZEN1045_PHASE_C_RECONCILE,
    runDzen1045PhaseCReconcile } from '../services/dzen_task1045_phase_c_reconcile_contract';

const incident = { state: 'phase_c_uncertain', phase_c_idempotency_key: DZEN1045_PHASE_C_RECONCILE.sourceKey,
    phase_c_dialog_fingerprint: DZEN1045_PHASE_C_RECONCILE.semanticFingerprint,
    phase_c_started_at: DZEN1045_PHASE_C_RECONCILE.startedAt,
    phase_c_failed_at: DZEN1045_PHASE_C_RECONCILE.failedAt,
    provider_object_id: DZEN1045_PHASE_C_RECONCILE.providerId,
    final_submit_allowed: false, final_submit_may_have_occurred: true,
    final_submit_count_max: 1, retry_via_api: false };
const publication = { public_url: 'https://dzen.ru/a/exact1045',
    provider_object_id: DZEN1045_PHASE_C_RECONCILE.providerId,
    published_at: '2026-10-11T21:06:14.000Z', public_body_matches: true as const,
    public_asset_matches: true as const, checked_at: '2026-10-11T21:10:00.000Z' };

test('phase C reconcile binds the exact frozen incident', () => {
    assert.doesNotThrow(() => assertDzen1045PhaseCIncident(incident));
    assert.throws(() => assertDzen1045PhaseCIncident({ ...incident, phase_c_failed_at: 'stale' }), /INCIDENT_MISMATCH/);
});

test('phase C reconcile preview is read-only and exact public records once only on confirm', async () => {
    let writes = 0;
    const ports = { inspect: async () => ({ kind: 'exact_public' as const, publication,
        evidence: { provider_writes: 0, clicked_controls: 0 } }),
    record: async () => { writes += 1; return { fact: 1 }; } };
    const preview = await runDzen1045PhaseCReconcile({ confirm: false,
        idempotencyKey: DZEN1045_PHASE_C_RECONCILE.idempotencyKey }, ports);
    assert.equal(preview.mode, 'preview'); assert.equal(writes, 0);
    const confirmed = await runDzen1045PhaseCReconcile({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_C_RECONCILE.idempotencyKey }, ports);
    assert.equal(confirmed.mode, 'reconciled'); assert.equal(writes, 1);
});

test('phase C reconcile never records a fact for exact draft or ambiguous inventory', async () => {
    let writes = 0;
    for (const kind of ['exact_draft', 'ambiguous'] as const) {
        const result = await runDzen1045PhaseCReconcile({ confirm: true,
            idempotencyKey: DZEN1045_PHASE_C_RECONCILE.idempotencyKey }, {
            inspect: async () => ({ kind, evidence: { provider_writes: 0, clicked_controls: 0 } }),
            record: async () => { writes += 1; return {}; }
        });
        assert.equal(result.mode, kind === 'exact_draft' ? 'exact_draft_no_public' : 'evidence_only');
    }
    assert.equal(writes, 0);
});
