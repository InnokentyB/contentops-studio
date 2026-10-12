import test from 'node:test';
import assert from 'node:assert/strict';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';

test('VK016-MCP: transport writes require Publisher role and authenticated exact project/actor', () => {
    for (const name of ['ba_dispatch_vk_connector_job', 'ba_poll_vk_connector_jobs', 'ba_ack_vk_connector_job',
        'ba_report_vk_connector_job', 'ba_reconcile_vk_connector_job']) {
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        for (const role of ['planner', 'writer', 'strategist', 'growth_analyst'] as const)
            assert.equal(isToolAllowedForProfile(role, name), false);
        const body = { method: 'tools/call', params: { name, arguments: { projectId: 10, actorId: 'user:999' } } };
        const principal = { userId: 2, actorId: 'user:2', projectId: 10, profile: 'publisher' as const };
        const allowed = scopeRemoteMcpRequest(body, principal); assert.equal(allowed.allowed, true);
        assert.equal(allowed.body.params.arguments.actorId, 'user:2');
        assert.equal(scopeRemoteMcpRequest(body, { ...principal, projectId: 7 }).allowed, false);
        assert.equal(scopeRemoteMcpRequest(body, { ...principal, profile: 'planner' }).allowed, false);
    }
});
