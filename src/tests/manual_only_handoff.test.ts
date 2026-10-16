import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedContentItemHandoff } from '../services/publication_plan/handoff';
import { publicationPlacementAssetContract } from '../services/publication_placement_contract';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import { scopeRemoteMcpRequest } from '../mcp/remote-auth';

test('manual-only channel overrides stale API flags without changing approval policy or copy', () => {
    const channel = { type: 'linkedin', name: 'seturon_linkedin_page', config: {
        execution_modes: ['manual'], capability_flags: { api_publish: true } } };
    const item = { id: 1136, channel, draft_text: 'Accepted unchanged copy', content_revision: 2,
        accepted_revision: null, publication_mode: 'approval_required', visual_placement: 'feed' };
    const before = structuredClone(item);
    const bundle = buildGeneratedContentItemHandoff(item);
    assert.equal(bundle.mode, 'manual');
    assert.equal(bundle.transport.connector_authority, 'manual_only');
    assert.equal(bundle.placement_contract.transport.connector_authority, 'manual_only');
    assert.deepEqual(item, before);
});

test('API-capable and unspecified channels retain configured transport; manual-only never widens transport', () => {
    assert.equal(publicationPlacementAssetContract({ type: 'linkedin', config: {
        execution_modes: ['automated', 'manual'] } }, 'feed').transport.connector_authority, 'configured');
    assert.equal(publicationPlacementAssetContract({ type: 'linkedin' }, 'feed').transport.connector_authority, 'configured');
    assert.equal(publicationPlacementAssetContract({ type: 'vk', config: {
        execution_modes: ['automated'] } }, 'article_cover').transport.connector_authority, 'manual_only');
});

test('repair is owner/Editor scoped; remote principal prevents caller impersonation and foreign project', () => {
    const command = 'ba_repair_content_review_handoff';
    assert.equal(isToolAllowedForProfile('editor', 'ba_get_content_review_repair_snapshot'), true);
    assert.equal(isToolAllowedForProfile('editor', command), true);
    for (const role of ['writer', 'publisher', 'art_director', 'planner'] as const) {
        assert.equal(isToolAllowedForProfile(role, command), false);
    }
    const principal = { userId: 2, actorId: 'user:2', projectId: 7, profile: 'editor' as const };
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: command, arguments: { projectId: 7, actorId: 'user:999' } } };
    const scoped = scopeRemoteMcpRequest(request, principal);
    assert.equal(scoped.allowed, true);
    assert.equal(scoped.body.params.arguments.actorId, 'user:2');
    assert.equal(scopeRemoteMcpRequest({ ...request, params: { ...request.params,
        arguments: { projectId: 10, actorId: 'user:2' } } }, principal).allowed, false);
});
