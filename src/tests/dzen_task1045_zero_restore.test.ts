import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDzen1045ZeroRelevantInventory, DZEN1045_ZERO_RESTORE,
    runDzen1045ZeroRestore } from '../services/dzen_task1045_zero_restore_contract';

const zero = { kind: 'no_exact_match' as const, diagnostics: { publishedMatches: 0, draftObjects: 0,
    exactDraftMatches: 0, bodyMismatches: 0, coverMismatches: 0, titleMismatches: 0 } };

test('task1045 zero restore preview is read-only', async () => {
    let claims = 0; let restores = 0;
    const result = await runDzen1045ZeroRestore({ confirm: false,
        idempotencyKey: DZEN1045_ZERO_RESTORE.idempotencyKey }, {
        inspect: async () => zero,
        claim: async () => { claims += 1; return true; },
        restore: async () => { restores += 1; return { public_url: 'never' }; }
    });
    assert.equal(result.mode, 'preview'); assert.equal(claims, 0); assert.equal(restores, 0);
});

test('task1045 zero restore claims before exactly one provider operation', async () => {
    const order: string[] = [];
    const result = await runDzen1045ZeroRestore({ confirm: true,
        idempotencyKey: DZEN1045_ZERO_RESTORE.idempotencyKey }, {
        inspect: async () => { order.push('inspect'); return zero; },
        claim: async () => { order.push('claim'); return true; },
        restore: async () => { order.push('restore'); return { finalSubmitCount: 1 }; }
    });
    assert.equal(result.mode, 'restored'); assert.deepEqual(order, ['inspect', 'claim', 'restore']);
});

test('task1045 zero restore refuses replay before a provider call', async () => {
    let restores = 0;
    await assert.rejects(runDzen1045ZeroRestore({ confirm: true,
        idempotencyKey: DZEN1045_ZERO_RESTORE.idempotencyKey }, {
        inspect: async () => zero, claim: async () => false,
        restore: async () => { restores += 1; return {}; }
    }), /ALREADY_CLAIMED/);
    assert.equal(restores, 0);
});

test('task1045 zero restore preserves ambiguous or exact inventory for adapter reconciliation', async () => {
    const exactDraft = { kind: 'exact_draft' as const, proof: { draftId: 'a'.repeat(16), coverId: 'cover',
        title: 'public', bodySha256: 'body', coverSha256: 'coverSha', publishedMatches: 0,
        publishedCoverageComplete: true, draftMatches: 1, draftCoverageComplete: true,
        finalControlReady: true } };
    const result = await runDzen1045ZeroRestore({ confirm: false,
        idempotencyKey: DZEN1045_ZERO_RESTORE.idempotencyKey }, {
        inspect: async () => exactDraft, claim: async () => true, restore: async () => ({})
    });
    assert.deepEqual(result, { mode: 'preview', inspection: exactDraft });
});

test('task1045 creates only from zero relevant objects and stops on mismatched or multiple drafts', () => {
    assert.doesNotThrow(() => assertDzen1045ZeroRelevantInventory(zero));
    assert.throws(() => assertDzen1045ZeroRelevantInventory({ kind: 'no_exact_match', diagnostics: {
        ...zero.diagnostics, bodyMismatches: 1 } }), /RESTORE_AMBIGUOUS/);
    assert.throws(() => assertDzen1045ZeroRelevantInventory({ kind: 'no_exact_match', diagnostics: {
        ...zero.diagnostics, exactDraftMatches: 2 } }), /RESTORE_AMBIGUOUS/);
});
