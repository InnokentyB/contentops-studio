import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMaterializationPreservesApproval, connectorAutoModeGuard, preparationRoute } from '../services/publication_approval_guard';

test('preflight preserves approval requirement regardless of connector capability', () => {
    assert.equal(preparationRoute('approval_required', false), 'preserve_approval');
    assert.equal(preparationRoute('approval_required', true), 'preserve_approval');
    assert.equal(preparationRoute('owner_released', false), 'preserve_approval');
    assert.equal(preparationRoute('owner_released', true), 'preserve_approval');
    assert.equal(preparationRoute('connector_auto', false), 'connector_auto');
    assert.equal(preparationRoute('manual_handoff', true), 'browser_required');
});

test('scheduler discovery and claim require explicit connector authorization', () => {
    assert.deepEqual(connectorAutoModeGuard(), { publication_mode: 'connector_auto' });
    assert.notEqual(connectorAutoModeGuard().publication_mode, 'approval_required');
    assert.notEqual(connectorAutoModeGuard().publication_mode, 'owner_released');
});

test('materialization cannot rewrite owner-gated modes into scheduler eligibility', () => {
    assert.doesNotThrow(() => assertMaterializationPreservesApproval('approval_required', 'approval_required'));
    assert.throws(() => assertMaterializationPreservesApproval('approval_required', 'automatic'), /OWNER_RELEASE_REQUIRED/);
    assert.throws(() => assertMaterializationPreservesApproval('owner_released', 'automatic'), /OWNER_RELEASE_REQUIRED/);
});
