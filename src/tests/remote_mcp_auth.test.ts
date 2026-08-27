import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';
import { createPlannerMcpServer } from '../mcp/shared';

const principal = { userId: 2, actorId: 'user:2' };

test('remote MCP replaces caller-controlled actor and user identities', () => {
    const result = scopeRemoteMcpRequest({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'ba_list_work_items', arguments: { projectId: 7, actorId: 'user:999', userId: 999 } }
    }, principal);

    assert.equal(result.allowed, true);
    assert.equal(result.body.params.arguments.actorId, 'user:2');
    assert.equal(result.body.params.arguments.userId, 2);
});

test('remote MCP denies cross-tenant administrative tools', () => {
    const result = scopeRemoteMcpRequest({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'ba_list_users', arguments: {} }
    }, principal);

    assert.equal(result.allowed, false);
});

test('local MCP without a configured principal preserves tool arguments', () => {
    const body = { method: 'tools/call', params: { name: 'ba_list_work_items', arguments: { actorId: 'user:3' } } };
    assert.equal(scopeRemoteMcpRequest(body, null).body, body);
});

test('writer MCP is restricted to its project and cannot invoke planner tools', () => {
    const writerPrincipal = {
        userId: 2,
        actorId: 'user:2',
        projectId: 7,
        profile: 'writer'
    } as any;

    const denied = scopeRemoteMcpRequest({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'ba_reschedule_work_item', arguments: { projectId: 99, actorId: 'user:999' } }
    }, writerPrincipal);
    assert.equal(denied.allowed, false);

    const allowed = scopeRemoteMcpRequest({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'ba_update_publication_content', arguments: { projectId: 99, taskId: 12, body: 'Draft', expectedRevision: 0 } }
    }, writerPrincipal);
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.body.params.arguments.projectId, 7);
});

test('writer MCP discovery exposes content tools but not slot mutation tools', () => {
    const server = createPlannerMcpServer({ profile: 'writer' } as any);
    const tools = Object.keys((server as any)._registeredTools || {});

    assert.ok(tools.includes('ba_update_publication_content'));
    assert.ok(tools.includes('ba_list_publication_tasks'));
    assert.ok(!tools.includes('ba_import_operational_plan'));
    assert.ok(!tools.includes('ba_materialize_publication_task'));
    assert.ok(!tools.includes('ba_reschedule_work_item'));
    assert.ok(!tools.includes('ba_confirm_publication'));
    assert.ok(!tools.includes('ba_recover_content_review'));
    assert.ok(!tools.includes('ba_recover_missing_content_review'));
    assert.ok(!tools.includes('ba_repair_publication_placement'));
});

test('planner MCP discovery exposes slot controls but not content mutation', () => {
    const server = createPlannerMcpServer({ profile: 'planner' } as any);
    const tools = Object.keys((server as any)._registeredTools || {});

    assert.ok(tools.includes('ba_import_operational_plan'));
    assert.ok(tools.includes('ba_materialize_publication_task'));
    assert.ok(tools.includes('ba_reschedule_work_item'));
    assert.ok(!tools.includes('ba_update_publication_content'));
    assert.ok(!tools.includes('ba_recover_content_review'));
    assert.ok(!tools.includes('ba_recover_missing_content_review'));
    assert.ok(!tools.includes('ba_repair_publication_placement'));
});

test('only the owner MCP profile discovers audited content review recovery', () => {
    const server = createPlannerMcpServer({ profile: 'owner' } as any);
    const tools = Object.keys((server as any)._registeredTools || {});
    assert.ok(tools.includes('ba_recover_content_review'));
    assert.ok(tools.includes('ba_recover_missing_content_review'));
    assert.ok(tools.includes('ba_repair_publication_placement'));
});
