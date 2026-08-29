import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAgentWorkspaceManifest,
    getAgentWorkspaceUpdate
} from '../services/agent_workspace_manifest.service';

const input = {
    project: { id: 10, name: 'AnalystCraft', slug: 'analystcraft', updatedAt: new Date('2026-08-28T10:00:00Z') },
    channels: [{ id: 113, name: 'analystcraft_habr', type: 'habr', updatedAt: new Date('2026-08-28T09:00:00Z') }],
    settings: [{ key: 'multi_agent_post_creator_model', value: 'gpt-5-mini', updatedAt: new Date('2026-08-28T08:00:00Z') }]
};

test('workspace manifest exposes the governed chat topology without secrets', () => {
    const manifest = buildAgentWorkspaceManifest(input);
    assert.equal(manifest.schema_version, '1.0');
    assert.equal(manifest.project.id, 10);
    assert.ok(manifest.chats.some((chat) => chat.id === 'planning_hq'));
    assert.ok(manifest.chats.some((chat) => chat.id === 'content_writer'));
    assert.ok(manifest.chats.some((chat) => chat.id === 'chief_editor'));
    assert.ok(manifest.chats.some((chat) => chat.id === 'art_director'));
    assert.ok(manifest.handoffs.some((edge) => edge.from === 'planning_hq' && edge.to === 'content_writer'));
    assert.match(manifest.checksum, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(manifest), /token|api[_-]?key|authorization/i);
});

test('workspace update is empty for a known checksum and returns a snapshot after configuration changes', () => {
    const before = buildAgentWorkspaceManifest(input);
    assert.deepEqual(getAgentWorkspaceUpdate(before, before.checksum), {
        changed: false,
        checksum: before.checksum,
        revision: before.revision
    });

    const after = buildAgentWorkspaceManifest({
        ...input,
        channels: [...input.channels, { id: 114, name: 'analystcraft_tg', type: 'telegram', updatedAt: new Date('2026-08-28T11:00:00Z') }]
    });
    const update = getAgentWorkspaceUpdate(after, before.checksum);
    assert.equal(update.changed, true);
    assert.equal(update.manifest?.checksum, after.checksum);
    assert.notEqual(after.checksum, before.checksum);
});

test('chat bootstrap is role-scoped and references an MCP capability profile', () => {
    const manifest = buildAgentWorkspaceManifest(input);
    const writer = manifest.chats.find((chat) => chat.id === 'content_writer');
    assert.equal(writer?.mcp_profile, 'writer');
    assert.ok(writer?.responsibilities.includes('Fill accepted publication slots with content'));
    assert.ok(!writer?.permissions.includes('change_schedule'));
});
