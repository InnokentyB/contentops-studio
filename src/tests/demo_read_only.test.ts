import test from 'node:test';
import assert from 'node:assert/strict';
import { isDemoMutationBlocked } from '../utils/demo_access';
import authService from '../services/auth.service';

const demoUser = { id: 101, email: 'demo@example.test', name: 'Product Demo', is_demo: true };
const regularUser = { ...demoUser, is_demo: false };

test('signed demo session preserves the server-side read-only claim', () => {
    const token = (authService as any).generateToken(demoUser);
    assert.equal(authService.verifyToken(token).is_demo, true);
});

test('LinkedIn OAuth state is signed, scoped, and rejects tampering', () => {
    const state = authService.createLinkedInOAuthState(101, 202);
    const binding = authService.verifyLinkedInOAuthState(state);
    assert.equal(binding.purpose, 'linkedin_oauth');
    assert.equal(binding.user_id, 101);
    assert.equal(binding.project_id, 202);
    assert.throws(() => authService.verifyLinkedInOAuthState(`${state}x`));
});

test('demo account can read project APIs', () => {
    assert.equal(isDemoMutationBlocked(demoUser, 'GET', '/api/publication-tasks'), false);
    assert.equal(isDemoMutationBlocked(demoUser, 'HEAD', '/api/health'), false);
});

test('demo account cannot change data or trigger publication', () => {
    assert.equal(isDemoMutationBlocked(demoUser, 'PUT', '/api/publication-tasks/42/content'), true);
    assert.equal(isDemoMutationBlocked(demoUser, 'POST', '/api/publication-tasks/42/publish-now'), true);
    assert.equal(isDemoMutationBlocked(demoUser, 'DELETE', '/api/projects/10/channels/4'), true);
});

test('demo restriction does not affect regular users or non-API navigation', () => {
    assert.equal(isDemoMutationBlocked(regularUser, 'POST', '/api/projects'), false);
    assert.equal(isDemoMutationBlocked(demoUser, 'POST', '/login'), false);
});
