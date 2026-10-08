import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPlannerMcpServer } from '../mcp/shared';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';
import { buildAgentWorkspaceManifest } from '../services/agent_workspace_manifest.service';

const name = 'ba_vk_search_relevant_posts';
test('real MCP discovery exposes bounded read-only VK schema in planner and strategist', async () => {
    for (const profile of ['planner', 'strategist', 'writer'] as const) {
        const server = createPlannerMcpServer({ profile });
        const client = new Client({ name: 'vk-search-acceptance', version: '1' });
        const [a, b] = InMemoryTransport.createLinkedPair();
        try {
            await server.connect(a); await client.connect(b);
            const tools = await client.listTools();
            const tool = tools.tools.find(tool => tool.name === name);
            if (profile === 'writer') { assert.equal(tool, undefined); continue; }
            assert.ok(tool);
            assert.equal(tool.annotations?.readOnlyHint, true);
            assert.equal(tool.annotations?.destructiveHint, false);
            assert.equal(tool.annotations?.openWorldHint, true);
            assert.ok(tool.inputSchema.properties?.routes);
            assert.ok(tool.inputSchema.properties?.since);
        } finally { await client.close(); await server.close(); }
    }
});

test('VK search remote call cannot override actor or project scope', () => {
    const principal = { userId: 2, actorId: 'user:2', projectId: 10, profile: 'planner' as const };
    const body = { method: 'tools/call', params: { name, arguments: { projectId: 10, actorId: 'user:999', channelId: 117 } } };
    const scoped = scopeRemoteMcpRequest(body, principal);
    assert.equal(scoped.allowed, true);
    assert.equal(scoped.body.params.arguments.actorId, 'user:2');
    const denied = scopeRemoteMcpRequest({ ...body, params: { name, arguments: { projectId: 11 } } }, principal);
    assert.equal(denied.allowed, false);
});

test('manifest advertises discovery and preserves UNKNOWN rules for both research roles', () => {
    const manifest = buildAgentWorkspaceManifest({ project: { id: 10, name: 'AnalystCraft', slug: 'analystcraft', updatedAt: new Date() }, channels: [], settings: [] });
    for (const id of ['strategist', 'planning_hq']) {
        const chat = manifest.chats.find(chat => chat.id === id);
        assert.ok(chat?.permissions.includes('search_public_vk_posts'));
        assert.ok(chat?.startup_instructions.some(instruction => instruction.includes(name)));
    }
});
