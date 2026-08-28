"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const remote_auth_1 = require("../mcp/remote-auth");
const shared_1 = require("../mcp/shared");
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
(0, node_test_1.default)('writer MCP is restricted to its project and cannot invoke planner tools', () => {
    const writerPrincipal = {
        userId: 2,
        actorId: 'user:2',
        projectId: 7,
        profile: 'writer'
    };
    const denied = (0, remote_auth_1.scopeRemoteMcpRequest)({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'ba_reschedule_work_item', arguments: { projectId: 99, actorId: 'user:999' } }
    }, writerPrincipal);
    strict_1.default.equal(denied.allowed, false);
    const allowed = (0, remote_auth_1.scopeRemoteMcpRequest)({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'ba_update_publication_content', arguments: { projectId: 99, taskId: 12, body: 'Draft', expectedRevision: 0 } }
    }, writerPrincipal);
    strict_1.default.equal(allowed.allowed, true);
    strict_1.default.equal(allowed.body.params.arguments.projectId, 7);
});
(0, node_test_1.default)('writer MCP discovery exposes content tools but not slot mutation tools', () => {
    const server = (0, shared_1.createPlannerMcpServer)({ profile: 'writer' });
    const tools = Object.keys(server._registeredTools || {});
    strict_1.default.ok(tools.includes('ba_update_publication_content'));
    strict_1.default.ok(tools.includes('ba_list_publication_tasks'));
    strict_1.default.ok(!tools.includes('ba_import_operational_plan'));
    strict_1.default.ok(!tools.includes('ba_materialize_publication_task'));
    strict_1.default.ok(!tools.includes('ba_reschedule_work_item'));
    strict_1.default.ok(!tools.includes('ba_confirm_publication'));
    strict_1.default.ok(!tools.includes('ba_recover_content_review'));
    strict_1.default.ok(!tools.includes('ba_recover_missing_content_review'));
    strict_1.default.ok(!tools.includes('ba_repair_publication_placement'));
});
(0, node_test_1.default)('planner MCP discovery exposes slot controls but not content mutation', () => {
    const server = (0, shared_1.createPlannerMcpServer)({ profile: 'planner' });
    const tools = Object.keys(server._registeredTools || {});
    strict_1.default.ok(tools.includes('ba_import_operational_plan'));
    strict_1.default.ok(tools.includes('ba_materialize_publication_task'));
    strict_1.default.ok(tools.includes('ba_publish_publication_task'));
    strict_1.default.ok(!tools.includes('ba_publish_direct'));
    strict_1.default.ok(tools.includes('ba_reschedule_work_item'));
    strict_1.default.ok(!tools.includes('ba_update_publication_content'));
    strict_1.default.ok(!tools.includes('ba_recover_content_review'));
    strict_1.default.ok(!tools.includes('ba_recover_missing_content_review'));
    strict_1.default.ok(!tools.includes('ba_repair_publication_placement'));
});
(0, node_test_1.default)('only the owner MCP profile discovers audited content review recovery', () => {
    const server = (0, shared_1.createPlannerMcpServer)({ profile: 'owner' });
    const tools = Object.keys(server._registeredTools || {});
    strict_1.default.ok(tools.includes('ba_recover_content_review'));
    strict_1.default.ok(tools.includes('ba_recover_missing_content_review'));
    strict_1.default.ok(tools.includes('ba_repair_publication_placement'));
});
