import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDzen1045RestoreIncident, DZEN1045_RESTORE_RECONCILE,
    runDzen1045RestoreReconcile } from '../services/dzen_task1045_restore_reconcile_contract';
import { inspectDzen1045RestoreIncident } from '../services/puppeteer/dzen1045_restore_reconcile';
import type { Page } from 'puppeteer';

const publication = { public_url: 'https://dzen.ru/a/exact1045', provider_object_id: 'a'.repeat(24),
    published_at: '2026-10-11T18:15:00.000Z', public_body_matches: true as const,
    public_asset_matches: true as const, checked_at: '2026-10-11T18:20:00.000Z' };
const exact = { kind: 'exact_published' as const, publication, evidence: { provider_writes: 0 } };

test('restore reconciliation binds the exact uncertain restore incident', () => {
    assert.doesNotThrow(() => assertDzen1045RestoreIncident({ state: 'zero_inventory_restore_uncertain',
        restore_idempotency_key: DZEN1045_RESTORE_RECONCILE.restoreKey,
        failed_at: DZEN1045_RESTORE_RECONCILE.failedAt, provider_create_may_have_occurred: true,
        final_submit_may_have_occurred: true, retry_via_api: false }));
    for (const changed of [{ failed_at: 'stale' }, { restore_idempotency_key: 'stale' },
        { provider_create_may_have_occurred: false }, { final_submit_may_have_occurred: false }]) {
        assert.throws(() => assertDzen1045RestoreIncident({ state: 'zero_inventory_restore_uncertain',
            restore_idempotency_key: DZEN1045_RESTORE_RECONCILE.restoreKey,
            failed_at: DZEN1045_RESTORE_RECONCILE.failedAt, provider_create_may_have_occurred: true,
            final_submit_may_have_occurred: true, retry_via_api: false, ...changed }), /INCIDENT_MISMATCH/);
    }
});

test('preview performs readback only and never reconciles', async () => {
    let writes = 0;
    const result = await runDzen1045RestoreReconcile({ confirm: false,
        idempotencyKey: DZEN1045_RESTORE_RECONCILE.idempotencyKey }, {
        inspect: async () => exact, reconcile: async () => { writes += 1; return {}; }
    });
    assert.equal(result.mode, 'preview'); assert.equal(writes, 0);
});

test('confirm reconciles one exact public object without a provider write port', async () => {
    let factWrites = 0;
    const result = await runDzen1045RestoreReconcile({ confirm: true,
        idempotencyKey: DZEN1045_RESTORE_RECONCILE.idempotencyKey }, {
        inspect: async () => exact, reconcile: async value => { factWrites += 1;
            assert.equal(value.provider_object_id, publication.provider_object_id); return { factId: 500 }; }
    });
    assert.equal(result.mode, 'reconciled'); assert.equal(factWrites, 1);
});

test('sole draft, zero and ambiguous inventory strictly forbid reconciliation', async () => {
    const cases = [
        { kind: 'sole_exact_draft' as const, draft: { draftId: 'b'.repeat(24), coverId: 'cover',
            title: 'exact', bodySha256: '37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1' as const,
            coverSha256: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b' as const }, evidence: {} },
        { kind: 'no_exact_match' as const, diagnostics: { exactDraftMatches: 0 }, evidence: {} }
    ];
    for (const inspection of cases) {
        let writes = 0;
        await assert.rejects(runDzen1045RestoreReconcile({ confirm: true,
            idempotencyKey: DZEN1045_RESTORE_RECONCILE.idempotencyKey }, {
            inspect: async () => inspection, reconcile: async () => { writes += 1; return {}; }
        }), /NOT_PUBLIC/);
        assert.equal(writes, 0);
    }
});

test('browser inspection uses read ports only and reports a sole exact draft without a click', async () => {
    let clicked = false;
    const page = { click: async () => { clicked = true; throw new Error('forbidden'); } } as unknown as Page;
    const result = await inspectDzen1045RestoreIncident(page, 'accepted', {
        enumerate: async (_page, _url, state) => ({ coverageComplete: true, publications: state === 'published' ? [] : [{
            provider_object_id: 'b'.repeat(24), title: '46 тестов зелёные. Почему я всё равно не называю AI-продукт запущенным',
            public_url: null, published_at: null, state: 'draft' as const }] }),
        readPackage: async () => ({ publicationId: 'b'.repeat(24), coverId: 'cover',
            title: '46 тестов зелёные. Почему я всё равно не называю AI-продукт запущенным',
            bodyMatches: true, coverSha256: '6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b' }),
        verifyPublicBody: async () => true
    });
    assert.equal(result.kind, 'sole_exact_draft');
    assert.equal(clicked, false);
    assert.equal(result.evidence.provider_writes, 0);
    assert.equal(result.evidence.publish_controls_clicked, 0);
});
