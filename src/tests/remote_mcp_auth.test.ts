import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';

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
