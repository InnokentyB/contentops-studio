import assert from 'node:assert/strict';
import test from 'node:test';

test('stored Dzen readiness distinguishes missing proof from expired or incomplete inventory, without provider reads', () => {
    const module: unknown = require('../services/dzen_stored_readiness');
    assert.ok(module && typeof module === 'object' && 'describeDzenStoredReadiness' in module);
    const describe = (module as { describeDzenStoredReadiness: (input: {
        ready: boolean; hasSession: boolean; hasChannel: boolean; proof: unknown; inventoryRequired: boolean; now: number;
    }) => { basis: string; blockers: string[] } }).describeDzenStoredReadiness;
    const base = { ready: false, hasSession: true, hasChannel: true, inventoryRequired: true, now: 2_000_000 };
    assert.deepEqual(describe({ ...base, proof: null }).blockers, ['PREFLIGHT_PROOF_MISSING']);
    const incomplete = describe({ ...base, proof: { authenticated: true, editor_available: true,
        checked_at: new Date(base.now).toISOString(), cookies: 'PRIVATE', inventory: { coverage_complete: false } } });
    assert.deepEqual(incomplete.blockers, ['INVENTORY_ABSENCE_NOT_VERIFIED']);
    assert.equal(incomplete.basis, 'stored_preflight_proof');
    assert.equal(JSON.stringify(incomplete).includes('PRIVATE'), false);
    assert.deepEqual(describe({ ...base, proof: { authenticated: true, editor_available: true,
        checked_at: new Date(0).toISOString(), inventory: { classification: 'absent', coverage_complete: true } } }).blockers,
    ['PREFLIGHT_PROOF_EXPIRED']);
});
