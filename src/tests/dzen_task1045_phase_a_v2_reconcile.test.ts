import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDzen1045PhaseAV2Incident, DZEN1045_PHASE_A_V2_RECONCILE,
    runDzen1045PhaseAV2Reconcile } from '../services/dzen_task1045_phase_a_v2_reconcile_contract';
import { isDzen1045ReconcileWriteMethod } from '../services/puppeteer/dzen1045_phase_a_v2_reconcile';

const draft = { kind: 'exact_durable_draft' as const, draft: {
    draftId: DZEN1045_PHASE_A_V2_RECONCILE.providerId, coverId: 'cover',
    title: '46 тестов зелёные. Почему я всё равно не называю AI-продукт запущенным' as const,
    bodySha256: '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1' as const,
    coverSha256: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b' as const,
    checkedAt: '2026-10-11T19:10:00.000Z' }, evidence: { provider_writes: 0 } };
const published = { kind: 'exact_published' as const, publication: {
    public_url: 'https://dzen.ru/a/exact1045', provider_object_id: DZEN1045_PHASE_A_V2_RECONCILE.providerId,
    published_at: '2026-10-11T19:02:00.000Z', public_body_matches: true as const,
    public_asset_matches: true as const, checked_at: '2026-10-11T19:10:00.000Z' },
evidence: { provider_writes: 0 } };

test('v2 reconciliation binds exact frozen incident and blocks browser mutations', () => {
    assert.doesNotThrow(() => assertDzen1045PhaseAV2Incident({ state: 'draft_phase_a_v2_uncertain',
        phase_a_v2_idempotency_key: DZEN1045_PHASE_A_V2_RECONCILE.sourceKey,
        phase_a_v2_failed_at: DZEN1045_PHASE_A_V2_RECONCILE.failedAt,
        final_submit_allowed: false, final_submit_count: 0, retry_via_api: false }));
    assert.throws(() => assertDzen1045PhaseAV2Incident({ state: 'draft_phase_a_v2_uncertain',
        phase_a_v2_idempotency_key: 'stale', phase_a_v2_failed_at: DZEN1045_PHASE_A_V2_RECONCILE.failedAt,
        final_submit_allowed: false, final_submit_count: 0, retry_via_api: false }), /INCIDENT_MISMATCH/);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isDzen1045ReconcileWriteMethod(method), true);
});

test('v2 reconciliation preview performs no local apply', async () => {
    let writes = 0;
    const result = await runDzen1045PhaseAV2Reconcile({ confirm: false,
        idempotencyKey: DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey }, {
        inspect: async () => draft, applyDraft: async () => { writes += 1; return {}; },
        applyPublished: async () => { writes += 1; return {}; }
    });
    assert.equal(result.mode, 'preview'); assert.equal(writes, 0);
});

test('v2 reconciliation applies only the exact durable draft or exact public object', async () => {
    let drafts = 0; let facts = 0;
    const draftResult = await runDzen1045PhaseAV2Reconcile({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey }, {
        inspect: async () => draft, applyDraft: async value => { drafts += 1;
            assert.equal(value.draftId, DZEN1045_PHASE_A_V2_RECONCILE.providerId); return {}; },
        applyPublished: async () => { facts += 1; return {}; }
    });
    const publicResult = await runDzen1045PhaseAV2Reconcile({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey }, {
        inspect: async () => published, applyDraft: async () => { drafts += 1; return {}; },
        applyPublished: async value => { facts += 1;
            assert.equal(value.provider_object_id, DZEN1045_PHASE_A_V2_RECONCILE.providerId); return {}; }
    });
    assert.equal(draftResult.mode, 'draft_reconciled'); assert.equal(publicResult.mode, 'published_reconciled');
    assert.equal(drafts, 1); assert.equal(facts, 1);
});

test('v2 reconciliation mismatch or zero returns evidence without writes', async () => {
    let writes = 0;
    const result = await runDzen1045PhaseAV2Reconcile({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_A_V2_RECONCILE.idempotencyKey }, {
        inspect: async () => ({ kind: 'no_exact_match', diagnostics: { target: 'missing' }, evidence: {} }),
        applyDraft: async () => { writes += 1; return {}; }, applyPublished: async () => { writes += 1; return {}; }
    });
    assert.equal(result.mode, 'evidence_only'); assert.equal(writes, 0);
});
