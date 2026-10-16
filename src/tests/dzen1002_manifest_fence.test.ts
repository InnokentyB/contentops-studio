import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTomorrowPublicationTools } from '../mcp/tools/tomorrow_publication_tools';
import { DzenTaskPublicationService } from '../services/dzen_task_publication.service';
import { assertDzen1002CurrentManifest } from '../services/dzen_task1002_manifest';
import { DZEN1002_ROUTE as binding } from '../services/dzen_task1002_route.service';
import dzenService from '../services/dzen.service';

const current = 'sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7';
const old = 'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b';
function harness(checksum = current, slug = 'analystcraft-2', role = 'owner') {
    const calls: string[] = [];
    const dependencies = {
        db: {
            projectMember: { findUnique: async () => { calls.push('owner'); return { role }; } },
            workflowEvent: { findUnique: async () => { calls.push('cached'); return { after_state: { mode: 'dry_run' } }; } }
        },
        manifestLoader: async () => { calls.push('manifest'); return { checksum, project: { slug } }; },
        dzen: {
            publishPost: async () => { calls.push('provider'); throw new Error('NO_PROVIDER'); },
            testConnection: async () => { throw new Error('NO_PROVIDER'); },
            readStudioPublications: async (): Promise<never> => { throw new Error('NO_PROVIDER'); }
        },
        facts: { record: async (): Promise<never> => { throw new Error('NO_FACT'); } }
    };
    return { calls, service: new DzenTaskPublicationService(dependencies) };
}
const args = { projectId: 10, taskId: 1002, actorId: 'user:2',
    expectedManifestChecksum: current, dryRun: true, idempotencyKey: 'manifest-fixture' };

test('all three dedicated schemas accept only the reviewed manifest, publish requires actor and checksum', () => {
    const schemas = new Map<string, z.ZodObject<z.ZodRawShape>>();
    const server = { registerTool(name: string, config: { inputSchema: z.ZodRawShape }) {
        schemas.set(name, z.object(config.inputSchema));
    } } as unknown as McpServer;
    registerTomorrowPublicationTools(server);
    for (const name of ['ba_release_dzen_task1002', 'ba_preflight_dzen_task1002', 'ba_publish_dzen_task1002']) {
        const schema = schemas.get(name)!;
        const input = { ...args, expectedBodySha256: '570bf2c102911ae4fc678ad453bb0289e48cf4e6161e874d6e39811e2527e9bb',
            expectedScheduleAt: '2026-10-13T11:30:00.000Z', approvalReference: 'existing owner release3126' };
        assert.equal(schema.safeParse(input).success, true, name);
        for (const checksum of [old, 'sha256:' + 'f'.repeat(64), 'malformed']) {
            assert.equal(schema.safeParse({ ...input, expectedManifestChecksum: checksum }).success, false, name);
        }
        assert.equal(schema.safeParse({ ...input, expectedManifestChecksum: undefined }).success, false, name);
        assert.equal(schema.safeParse({ ...input, actorId: undefined }).success, false, name);
    }
});
test('publish fences live manifest before even cached readiness and has no provider/write side effect', async () => {
    const h = harness();
    await h.service.execute(args);
    assert.deepEqual(h.calls, ['owner', 'manifest', 'cached']);
});
test('old or missing caller checksum cannot enter publish, including cached replay', async () => {
    for (const checksum of [old, undefined, 'malformed']) {
        const h = harness();
        await assert.rejects(h.service.execute({ ...args, expectedManifestChecksum: checksum }), /STALE_MANIFEST/);
        assert.deepEqual(h.calls, []);
    }
});
test('live drift and foreign manifest block dry-run and live before cache/attempt/provider', async () => {
    for (const dryRun of [true, false]) for (const [checksum, slug] of [[old, 'analystcraft-2'], [current, 'foreign']]) {
        const h = harness(checksum, slug);
        await assert.rejects(h.service.execute({ ...args, dryRun }), /STALE_MANIFEST/);
        assert.deepEqual(h.calls, ['owner', 'manifest']);
    }
});
test('non-owner, missing actor and foreign project cannot use the task1002 fence', async () => {
    const h = harness(current, 'analystcraft-2', 'writer');
    await assert.rejects(h.service.execute(args), /OWNER_REQUIRED/);
    assert.deepEqual(h.calls, ['owner']);
    const noActor = harness();
    await assert.rejects(noActor.service.execute({ ...args, actorId: undefined }), /OWNER_REQUIRED/);
    assert.deepEqual(noActor.calls, []);
    const foreign = harness();
    await assert.rejects(foreign.service.execute({ ...args, projectId: 7 }), /SCOPE_MISMATCH/);
    assert.deepEqual(foreign.calls, []);
});
test('shared preflight guard accepts exact current identity and rejects later drift or loader failure', async () => {
    await assertDzen1002CurrentManifest(2, async (projectId, userId) => {
        assert.equal(projectId, 10); assert.equal(userId, 2);
        return { checksum: current, project: { slug: 'analystcraft-2' } };
    });
    await assert.rejects(assertDzen1002CurrentManifest(2, async () => ({
        checksum: old, project: { slug: 'analystcraft-2' }
    })), /STALE_MANIFEST/);
    await assert.rejects(assertDzen1002CurrentManifest(2, async () => { throw new Error('MANIFEST_UNAVAILABLE'); }),
        /MANIFEST_UNAVAILABLE/);
});
test('current manifest preserves release3126/package guards and dry-run remains no-send', async () => {
    const h = harness();
    const task = { id: 1002, channel_id: 116, content_revision: 3, accepted_revision: 3,
        text_state: 'accepted', visual_state: 'APPROVED', visual_placement: 'article_cover',
        visual_decision_version: 2, selected_asset_id: 151, publication_mode: 'owner_released',
        handoff_state: 'ready', status: 'ready_for_execution', published_link: null, publication_fact: null,
        schedule_at: new Date(binding.schedule), publish_at: new Date(binding.schedule), draft_text: 'fixture body',
        title: 'Fixture title', channel: { type: 'dzen', config: {} },
        selected_asset: { id: 151, status: 'approved', content_revision: 3,
            file_url: 'https://assets.example.test/image.png', provenance: { planner_storage: { sha256: binding.assetSha256 } } } };
    const release = { task_id: 1002, channel_id: 116, content_revision: 3, accepted_revision: 3,
        body_sha256: binding.bodySha256, visual_decision_id: 300, selected_asset_id: 151,
        asset_sha256: binding.assetSha256, schedule_at: binding.schedule, publication_mode: 'owner_released' };
    let attempts: { id: number; status: string } | null = null;
    const releaseBefore = JSON.stringify(release);
    const service = new DzenTaskPublicationService({
        db: {
            projectMember: { findUnique: async () => ({ role: 'owner' }) },
            contentItem: { findFirst: async () => task },
            deliveryAttempt: { findFirst: async () => attempts },
            artDirectionDecision: { findFirst: async () => ({ id: 300, decision_version: 2 }) },
            workflowEvent: { findUnique: async () => null,
                findFirst: async (query: { where: { command: string } }) => {
                    if (query.where.command === 'ba_release_dzen_task1002') return { id: 3126, after_state: release };
                    return null;
                } }
        },
        manifestLoader: async () => ({ checksum: current, project: { slug: 'analystcraft-2' } }),
        hashBody: () => binding.bodySha256,
        dzen: { publishPost: async (): Promise<never> => { throw new Error('FORBIDDEN_SEND'); },
            testConnection: async (): Promise<never> => { throw new Error('FORBIDDEN_PROVIDER'); },
            readStudioPublications: async (): Promise<never> => { throw new Error('FORBIDDEN_PROVIDER'); } },
        facts: { record: async (): Promise<never> => { throw new Error('FORBIDDEN_FACT'); } }
    });
    const result = await service.execute(args);
    assert.equal(result.mode, 'dry_run');
    assert.equal(result.connector_ready, false); // Current manifest is not native readiness.
    assert.equal(JSON.stringify(release), releaseBefore);
    attempts = { id: 1, status: 'pending' };
    await assert.rejects(service.execute(args), /DZEN_OWNER_RELEASE_PROOF_MISMATCH/);
    assert.equal(JSON.stringify(release), releaseBefore);
    assert.deepEqual(h.calls, []);
});
test('production task1002 reader has no session access without action-time admission', async () => {
    let cookieReads = 0;
    const config = { channel_id: binding.providerChannelId, provider_admission: 'permitted',
        get cookies() { cookieReads++; return ''; } };
    await assert.rejects(dzenService.readStudioPublications(config, 1002), /DZEN1002_ACTION_SCOPE_UNRESOLVED/);
    assert.equal(cookieReads, 0);
});
test('reviewed manifest and a cached proof cannot admit a live send without runtime authority', async () => {
    const h = harness();
    await assert.rejects(h.service.execute({ ...args, dryRun: false }), /DZEN1002_ACTION_SCOPE_UNRESOLVED/);
    assert.deepEqual(h.calls, ['owner', 'manifest']);
});
