"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const agent_workspace_manifest_service_1 = require("../services/agent_workspace_manifest.service");
const input = {
    project: { id: 10, name: 'AnalystCraft', slug: 'analystcraft', updatedAt: new Date('2026-08-28T10:00:00Z') },
    channels: [{ id: 113, name: 'analystcraft_habr', type: 'habr', updatedAt: new Date('2026-08-28T09:00:00Z') }],
    settings: [{ key: 'multi_agent_post_creator_model', value: 'gpt-5-mini', updatedAt: new Date('2026-08-28T08:00:00Z') }]
};
(0, node_test_1.default)('workspace manifest exposes the governed chat topology without secrets', () => {
    const manifest = (0, agent_workspace_manifest_service_1.buildAgentWorkspaceManifest)(input);
    strict_1.default.equal(manifest.schema_version, '1.0');
    strict_1.default.equal(manifest.project.id, 10);
    strict_1.default.ok(manifest.chats.some((chat) => chat.id === 'planning_hq'));
    strict_1.default.ok(manifest.chats.some((chat) => chat.id === 'content_writer'));
    strict_1.default.ok(manifest.chats.some((chat) => chat.id === 'chief_editor'));
    strict_1.default.ok(manifest.chats.some((chat) => chat.id === 'art_director'));
    strict_1.default.ok(manifest.handoffs.some((edge) => edge.from === 'planning_hq' && edge.to === 'content_writer'));
    strict_1.default.match(manifest.checksum, /^sha256:[a-f0-9]{64}$/);
    strict_1.default.doesNotMatch(JSON.stringify(manifest), /token|api[_-]?key|authorization/i);
});
(0, node_test_1.default)('workspace update is empty for a known checksum and returns a snapshot after configuration changes', () => {
    const before = (0, agent_workspace_manifest_service_1.buildAgentWorkspaceManifest)(input);
    strict_1.default.deepEqual((0, agent_workspace_manifest_service_1.getAgentWorkspaceUpdate)(before, before.checksum), {
        changed: false,
        checksum: before.checksum,
        revision: before.revision
    });
    const after = (0, agent_workspace_manifest_service_1.buildAgentWorkspaceManifest)({
        ...input,
        channels: [...input.channels, { id: 114, name: 'analystcraft_tg', type: 'telegram', updatedAt: new Date('2026-08-28T11:00:00Z') }]
    });
    const update = (0, agent_workspace_manifest_service_1.getAgentWorkspaceUpdate)(after, before.checksum);
    strict_1.default.equal(update.changed, true);
    strict_1.default.equal(update.manifest?.checksum, after.checksum);
    strict_1.default.notEqual(after.checksum, before.checksum);
});
(0, node_test_1.default)('chat bootstrap is role-scoped and references an MCP capability profile', () => {
    const manifest = (0, agent_workspace_manifest_service_1.buildAgentWorkspaceManifest)(input);
    const writer = manifest.chats.find((chat) => chat.id === 'content_writer');
    strict_1.default.equal(writer?.mcp_profile, 'writer');
    strict_1.default.ok(writer?.responsibilities.includes('Fill accepted publication slots with content'));
    strict_1.default.ok(!writer?.permissions.includes('change_schedule'));
});
