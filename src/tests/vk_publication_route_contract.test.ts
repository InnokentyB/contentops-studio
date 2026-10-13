import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { buildAgentWorkspaceManifest } from '../services/agent_workspace_manifest.service';
import { createVk1048PlaywrightRuntime } from '../services/vk1048_playwright_runtime';
import { runVk1048ProviderJob } from '../services/vk1048_provider_execution';
const Contract = z.object({
    VK_PUBLICATION_ROUTE: z.literal('planner_registered_independent_adapter'),
    assertVkPublicationRoute: z.custom<(route: unknown) => void>(v => typeof v === 'function'),
    vkPublicationAdapterRequired: z.custom<() => { code: string; next_route: string; retry_via_api: boolean; message: string }>(v => typeof v === 'function')
});
function contract() {
    let raw: unknown;
    try { raw = require('../services/vk_publication_route_contract'); }
    catch (error: unknown) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error;
        raw = null; // Expected missing behavior before the implementation exists.
    }
    const result = Contract.safeParse(raw);
    assert.equal(result.success, true, 'governed independent route contract is missing');
    if (!result.success) throw new Error('unreachable after assertion');
    return result.data;
}
test('VKROUTE-001 only the documented registered adapter route is accepted; metadata grants no permission', () => {
    const c = contract();
    c.assertVkPublicationRoute(c.VK_PUBLICATION_ROUTE);
    for (const route of [null, undefined, 'codex_cua', 'computer_use', 'personal_tab', 'raw_cdp', 'direct_api', 'alternate_worker']) {
        assert.throws(() => c.assertVkPublicationRoute(route), /VK_PUBLICATION_WRONG_ROUTE/);
    }
    const blocked = c.vkPublicationAdapterRequired();
    assert.equal(blocked.code, 'VK_INDEPENDENT_ADAPTER_REQUIRED');
    assert.equal(blocked.next_route, 'vk_adapter_required');
    assert.equal(blocked.retry_via_api, false);
});
test('VKROUTE-002 every role bootstrap with a VK channel receives the same no-Codex-browser contract', () => {
    const manifest = buildAgentWorkspaceManifest({ project: { id: 10, name: 'fixture', slug: 'fixture', updatedAt: new Date('2026-10-13T10:00:00Z') },
        channels: [{ id: 117, name: 'fixture vk', type: 'vk', updatedAt: new Date('2026-10-13T10:00:00Z') }], settings: [] });
    assert.equal(manifest.chats.length, 7);
    for (const chat of manifest.chats) {
        const rule = chat.startup_instructions.find(s => s.includes('vk-owned-publication-route.md'));
        assert.ok(rule, `missing route contract in ${chat.id}`);
        assert.match(rule, /Planner.*registered independent adapter/);
        assert.match(rule, /cua.getTab/);
        assert.match(rule, /preflight.*UAT/);
        assert.match(rule, /BLOCKED/);
        assert.match(rule, /denial/);
        assert.match(rule, /uncertain.*retry/);
    }
});
test('VKROUTE-003 wrong in-process production route fails before admission, control, profile or provider actions', async () => {
    let admission = 0, launches = 0, calls = 0;
    const runtime = createVk1048PlaywrightRuntime({ actionAdmission: { assess: async () => { admission++; return { status: 'PERMISSION_UNVERIFIED' }; } },
        profileDirectory: '/never-open', evidenceDir: '/never-open', approvedAssetSha256: 'a'.repeat(64),
        loadApprovedImage: async () => { throw new Error('must not load'); },
        launch: { launch: async () => { launches++; throw new Error('must not launch'); } } });
    Object.defineProperty(runtime, 'route', { value: 'codex_cua' });
    const result = await runVk1048ProviderJob({}, { call: async () => { calls++; throw new Error('must not call'); }, close: async () => undefined }, runtime);
    assert.equal(result.reason, 'VK_PUBLICATION_WRONG_ROUTE');
    assert.equal(admission + launches + calls, 0);
});
test('VKROUTE-004 direct runtime session entry also rejects a changed route before profile access', async () => {
    let admission = 0, launches = 0;
    const runtime = createVk1048PlaywrightRuntime({ actionAdmission: { assess: async () => { admission++; return { status: 'PERMISSION_UNVERIFIED' }; } },
        profileDirectory: '/never-open', evidenceDir: '/never-open', approvedAssetSha256: 'a'.repeat(64),
        loadApprovedImage: async () => { throw new Error('must not load'); },
        launch: { launch: async () => { launches++; throw new Error('must not launch'); } } });
    Object.defineProperty(runtime, 'route', { value: 'personal_tab' });
    await assert.rejects(runtime.withSession(async () => undefined), /VK_PUBLICATION_WRONG_ROUTE/);
    assert.equal(admission + launches, 0);
});
