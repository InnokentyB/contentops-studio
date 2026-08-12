"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const remote_auth_1 = require("../mcp/remote-auth");
const principal = { userId: 2, actorId: 'user:2' };
(0, node_test_1.default)('remote MCP replaces caller-controlled actor and user identities', () => {
    const result = (0, remote_auth_1.scopeRemoteMcpRequest)({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'ba_list_work_items', arguments: { projectId: 7, actorId: 'user:999', userId: 999 } }
    }, principal);
    strict_1.default.equal(result.allowed, true);
    strict_1.default.equal(result.body.params.arguments.actorId, 'user:2');
    strict_1.default.equal(result.body.params.arguments.userId, 2);
});
(0, node_test_1.default)('remote MCP denies cross-tenant administrative tools', () => {
    const result = (0, remote_auth_1.scopeRemoteMcpRequest)({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'ba_list_users', arguments: {} }
    }, principal);
    strict_1.default.equal(result.allowed, false);
});
(0, node_test_1.default)('local MCP without a configured principal preserves tool arguments', () => {
    const body = { method: 'tools/call', params: { name: 'ba_list_work_items', arguments: { actorId: 'user:3' } } };
    strict_1.default.equal((0, remote_auth_1.scopeRemoteMcpRequest)(body, null).body, body);
});
