import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDependencyConfirmation } from '../services/initiative.service';

test('standalone initiatives can be confirmed with state none', () => {
    assert.deepEqual(validateDependencyConfirmation('none', []), {
        releaseDependencyCount: 0,
        unresolvedReleaseDependencyCount: 0
    });
});

test('state none rejects unresolved release dependencies', () => {
    assert.throws(
        () => validateDependencyConfirmation('none', [
            { type: 'blocks', sourceStatus: 'in_progress', sourceKey: 'BUG-1' },
            { type: 'informs', sourceStatus: 'in_progress', sourceKey: 'NOTE-1' }
        ]),
        /DEPENDENCIES_PRESENT.*BUG-1/
    );
});

test('completed release dependencies do not prevent a fresh no-dependency audit', () => {
    assert.deepEqual(validateDependencyConfirmation('none', [
        { type: 'blocks', sourceStatus: 'completed', sourceKey: 'FIXED-BUG' }
    ]), {
        releaseDependencyCount: 1,
        unresolvedReleaseDependencyCount: 0
    });
});

test('state confirmed requires a stored release dependency graph', () => {
    assert.throws(
        () => validateDependencyConfirmation('confirmed', [
            { type: 'informs', sourceStatus: 'in_progress', sourceKey: 'NOTE-1' }
        ]),
        /DEPENDENCIES_ABSENT/
    );
});
