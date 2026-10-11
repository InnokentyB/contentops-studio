import test from 'node:test';
import assert from 'node:assert/strict';
import { DZEN1045_PHASE_B, runDzen1045PhaseB } from '../services/dzen_task1045_phase_b_contract';

const preflight = { providerId: '6acbdd8a8645cd779010ee4e' as const, exactPackage: true as const,
    detailStatus: 'draft' as const, enabledFinalControls: 1 as const,
    finalSelector: '[data-testid="article-publish-btn"]' as const, providerWrites: 0 as const };
const publication = { public_url: 'https://dzen.ru/a/exact1045',
    provider_object_id: '6acbdd8a8645cd779010ee4e' as const,
    published_at: '2026-10-11T19:30:00.000Z', public_body_matches: true as const,
    public_asset_matches: true as const, checked_at: '2026-10-11T19:31:00.000Z' };

test('phase B preview is provider-read-only and performs no claim or click', async () => {
    const order: string[] = [];
    const result = await runDzen1045PhaseB({ confirm: false, idempotencyKey: DZEN1045_PHASE_B.idempotencyKey }, {
        inspect: async () => { order.push('inspect'); return preflight; },
        claim: async () => { order.push('claim'); return true; },
        submitOnce: async () => { order.push('submit'); return publication; },
        record: async () => { order.push('record'); return {}; }
    });
    assert.equal(result.mode, 'preview'); assert.deepEqual(order, ['inspect']);
});

test('phase B claims then clicks once and records only exact verified publication', async () => {
    const order: string[] = [];
    const result = await runDzen1045PhaseB({ confirm: true, idempotencyKey: DZEN1045_PHASE_B.idempotencyKey }, {
        inspect: async () => { order.push('inspect'); return preflight; },
        claim: async () => { order.push('claim'); return true; },
        submitOnce: async () => { order.push('submit'); return publication; },
        record: async value => { order.push('record'); assert.equal(value.provider_object_id, preflight.providerId); return {}; }
    });
    assert.equal(result.mode, 'published'); assert.deepEqual(order, ['inspect', 'claim', 'submit', 'record']);
});

test('phase B refuses non-draft, ambiguous control and replayed claim before provider click', async () => {
    let submits = 0;
    for (const changed of [{ detailStatus: 'published' }, { enabledFinalControls: 2 }]) {
        await assert.rejects(runDzen1045PhaseB({ confirm: true,
            idempotencyKey: DZEN1045_PHASE_B.idempotencyKey }, {
            inspect: async () => ({ ...preflight, ...changed }) as never,
            claim: async () => true, submitOnce: async () => { submits += 1; return publication; }, record: async () => ({})
        }), /PREFLIGHT_INVALID/);
    }
    await assert.rejects(runDzen1045PhaseB({ confirm: true,
        idempotencyKey: DZEN1045_PHASE_B.idempotencyKey }, {
        inspect: async () => preflight, claim: async () => false,
        submitOnce: async () => { submits += 1; return publication; }, record: async () => ({})
    }), /ALREADY_CLAIMED/);
    assert.equal(submits, 0);
});
