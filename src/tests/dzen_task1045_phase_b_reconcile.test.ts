import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDzen1045PhaseBIncident, DZEN1045_PHASE_B_RECONCILE,
    runDzen1045PhaseBReconcile } from '../services/dzen_task1045_phase_b_reconcile_contract';

const publication = { public_url: 'https://dzen.ru/a/exact1045',
    provider_object_id: '6acbdd8a8645cd779010ee4e', published_at: '2026-10-11T19:28:00.000Z',
    public_body_matches: true as const, public_asset_matches: true as const,
    checked_at: '2026-10-11T19:30:00.000Z' };

test('phase B reconcile binds exact frozen one-click incident', () => {
    assert.doesNotThrow(() => assertDzen1045PhaseBIncident({ state: 'phase_b_uncertain',
        phase_b_idempotency_key: DZEN1045_PHASE_B_RECONCILE.sourceKey,
        phase_b_failed_at: DZEN1045_PHASE_B_RECONCILE.failedAt,
        provider_object_id: DZEN1045_PHASE_B_RECONCILE.providerId,
        final_submit_allowed: false, final_submit_may_have_occurred: true, retry_via_api: false }));
    assert.throws(() => assertDzen1045PhaseBIncident({ state: 'phase_b_uncertain',
        phase_b_idempotency_key: 'stale', phase_b_failed_at: DZEN1045_PHASE_B_RECONCILE.failedAt,
        provider_object_id: DZEN1045_PHASE_B_RECONCILE.providerId,
        final_submit_allowed: false, final_submit_may_have_occurred: true, retry_via_api: false }), /INCIDENT_MISMATCH/);
});

test('phase B reconcile records only exact public and leaves draft/ambiguous evidence-only', async () => {
    let writes = 0;
    const preview = await runDzen1045PhaseBReconcile({ confirm: false,
        idempotencyKey: DZEN1045_PHASE_B_RECONCILE.idempotencyKey }, {
        inspect: async () => ({ kind: 'exact_public' as const, publication, evidence: { provider_writes: 0 } }),
        record: async () => { writes += 1; return {}; }, recordNotAttempted: async () => { writes += 1; return {}; }
    });
    assert.equal(preview.mode, 'preview'); assert.equal(writes, 0);
    const confirmed = await runDzen1045PhaseBReconcile({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_B_RECONCILE.idempotencyKey }, {
        inspect: async () => ({ kind: 'exact_public' as const, publication, evidence: { provider_writes: 0 } }),
        record: async value => { writes += 1; assert.equal(value.provider_object_id,
            DZEN1045_PHASE_B_RECONCILE.providerId); return {}; },
        recordNotAttempted: async () => { writes += 1; return {}; }
    });
    assert.equal(confirmed.mode, 'reconciled'); assert.equal(writes, 1);
    const exactDraft = await runDzen1045PhaseBReconcile({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_B_RECONCILE.idempotencyKey }, {
        inspect: async () => ({ kind: 'exact_draft', evidence: { provider_writes: 0 } }),
        record: async () => { writes += 1; return {}; },
        recordNotAttempted: async () => { writes += 1; return {}; }
    });
    assert.equal(exactDraft.mode, 'not_attempted_final'); assert.equal(writes, 2);
    const ambiguous = await runDzen1045PhaseBReconcile({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_B_RECONCILE.idempotencyKey }, {
        inspect: async () => ({ kind: 'ambiguous', evidence: { provider_writes: 0 } }),
        record: async () => { writes += 1; return {}; },
        recordNotAttempted: async () => { writes += 1; return {}; }
    });
    assert.equal(ambiguous.mode, 'evidence_only'); assert.equal(writes, 2);
});
