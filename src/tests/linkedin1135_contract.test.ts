import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';

test('LinkedIn1135 exact lifecycle is publisher-only and cannot impersonate another project/actor', () => {
    const commands = ['release_linkedin_task1135_browser', 'claim_linkedin_task1135_browser_publication',
        'start_linkedin_task1135_browser_submission', 'pre_submit_linkedin_task1135_browser_submission',
        'confirm_linkedin_task1135_browser_submission', 'mark_linkedin_task1135_browser_submission_uncertain',
        'reconcile_linkedin_task1135_browser_submission', 'diagnose_linkedin_task1135_browser'];
    for (const suffix of commands) {
        const name = `ba_${suffix}`;
        assert.equal(isToolAllowedForProfile('publisher', name), true, name);
        for (const role of ['writer','editor','art_director','planner'] as const) assert.equal(isToolAllowedForProfile(role, name), false);
    }
    const principal = { userId: 2, actorId: 'user:2', projectId: 10, profile: 'publisher' as const };
    const req = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'ba_release_linkedin_task1135_browser', arguments: { projectId: 10, actorId: 'user:999' } } };
    const scoped = scopeRemoteMcpRequest(req, principal);
    assert.equal(scoped.allowed, true);
    assert.equal(scoped.body.params.arguments.actorId, 'user:2');
    assert.equal(scopeRemoteMcpRequest({ ...req, params: { ...req.params, arguments: { projectId: 7 } } }, principal).allowed, false);
});
