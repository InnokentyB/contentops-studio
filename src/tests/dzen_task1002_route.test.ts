import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolAllowedForProfile } from '../mcp/capabilities';
import {
    classifyDzenProviderInventory,
    DZEN_TASK_SPECS,
    DzenTaskPublicationService
} from '../services/dzen_task_publication.service';
import {
    DZEN1002_ROUTE,
    releaseDzenTask1002
} from '../services/dzen_task1002_route.service';

test('Dzen task1002 route binds the exact accepted package and provider identity', () => {
    assert.deepEqual(DZEN1002_ROUTE, {
        projectId: 10, taskId: 1002, channelId: 116, revision: 3,
        bodySha256: '570bf2c102911ae4fc678ad453bb0289e48cf4e6161e874d6e39811e2527e9bb',
        decisionId: 300, decisionVersion: 2, selectedAssetId: 151,
        assetSha256: '003dae64a6087ee456bb9af583b78955c6a6738de294ca7cf75c83b151d06a12',
        placement: 'article_cover', schedule: '2026-10-13T11:30:00.000Z',
        manifest: 'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b',
        providerChannelId: '6a8029aba055ec36033bf81c'
    });
    assert.deepEqual(DZEN_TASK_SPECS[1002], {
        bodySha256: DZEN1002_ROUTE.bodySha256,
        decisionId: 300, releaseCommand: 'ba_release_dzen_task1002',
        verifyCommand: 'ba_preflight_dzen_task1002', revision: 3,
        placement: 'article_cover', visualState: 'APPROVED', selectedAssetId: 151,
        publicationType: 'article', allowedStatuses: ['ready_for_execution'],
        schedule: DZEN1002_ROUTE.schedule,
        assetSha256: DZEN1002_ROUTE.assetSha256, decisionChannel: 'dzen',
        providerChannelId: DZEN1002_ROUTE.providerChannelId
    });
});

test('Dzen task1002 release rejects stale package input before touching storage', async () => {
    await assert.rejects(releaseDzenTask1002({
        projectId: 10, taskId: 1002, actorId: 'user:2',
        expectedManifestChecksum: DZEN1002_ROUTE.manifest,
        expectedBodySha256: 'changed' as typeof DZEN1002_ROUTE.bodySha256,
        expectedScheduleAt: DZEN1002_ROUTE.schedule,
        approvalReference: 'Owner approval at scheduled slot',
        idempotencyKey: 'dzen1002-release-scope-test'
    }), /DZEN1002_ROUTE_SCOPE_MISMATCH/);
});

test('Dzen task1002 provider inventory fails closed and detects exact-title duplicates', () => {
    const base = { publicationsPayloadReceived: true, titleReadbackComplete: true,
        coverageComplete: true, expectedTitle: 'Decision log: как не потерять допущения и доказательства' };
    assert.deepEqual(classifyDzenProviderInventory({ ...base, coverageComplete: false, publications: [] }),
        { classification: 'incomplete', exactTitleMatches: 0 });
    assert.deepEqual(classifyDzenProviderInventory({ ...base, publications: [
        { title: '  DECISION LOG: как не потерять допущения и доказательства  ' },
        { title: 'Другая статья' }
    ] }), { classification: 'duplicate', exactTitleMatches: 1 });
    assert.deepEqual(classifyDzenProviderInventory({ ...base, publications: [
        { title: 'Другая статья' }
    ] }), { classification: 'absent', exactTitleMatches: 0 });
});

test('Dzen task1002 controls are restricted to owner and publisher profiles', () => {
    for (const tool of ['ba_release_dzen_task1002', 'ba_preflight_dzen_task1002',
        'ba_publish_dzen_task1002']) {
        assert.equal(isToolAllowedForProfile('owner', tool), true);
        assert.equal(isToolAllowedForProfile('publisher', tool), true);
        assert.equal(isToolAllowedForProfile('planner', tool), false);
        assert.equal(isToolAllowedForProfile('writer', tool), false);
    }
});

test('Dzen task1002 preflight records complete provider absence proof for the exact identity', async () => {
    const events: unknown[] = [];
    const task = {
        id: 1002, project_id: 10, channel_id: 116,
        channel: { type: 'dzen', config: { cookies: 'session=fixture',
            channel_id: DZEN1002_ROUTE.providerChannelId } },
        status: 'ready_for_execution', publication_mode: 'owner_released',
        content_revision: 3, accepted_revision: 3, draft_text: 'accepted body',
        title: 'Decision log: как не потерять допущения и доказательства',
        visual_placement: 'article_cover', visual_state: 'APPROVED',
        selected_asset_id: 151, selected_asset: { status: 'approved', content_revision: 3,
            file_url: 'https://cdn.example.test/dzen1002.png', provenance: { planner_storage: {
                sha256: DZEN1002_ROUTE.assetSha256 } } },
        schedule_at: new Date(DZEN1002_ROUTE.schedule), publish_at: new Date(DZEN1002_ROUTE.schedule),
        publication_fact: null, published_link: null, quality_report: {}
    };
    const db: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        workflowEvent: { findFirst: async () => null,
            create: async (event: unknown) => { events.push(event); return event; } },
        contentItem: { findFirst: async () => task },
        deliveryAttempt: { findFirst: async () => null },
        $transaction: async (fn: (tx: unknown) => unknown) => fn(db)
    };
    const service = new DzenTaskPublicationService({
        db, hashBody: () => DZEN1002_ROUTE.bodySha256,
        dzen: {
            publishPost: async () => { throw new Error('must not publish'); },
            testConnection: async () => { throw new Error('must use inventory readback'); },
            readStudioPublications: async () => ({ authenticated: true, editor_available: true,
                editor_url: `https://dzen.ru/profile/editor/id/${DZEN1002_ROUTE.providerChannelId}/publications`,
                publications_payload_received: true, title_readback_complete: true,
                publication_timestamp_readback_complete: true, state_readback_complete: true,
                coverage_complete: true, publications: [{ title: 'Другая статья', public_url: null,
                    provider_object_id: 'draft-1', published_at: null, state: 'draft' as const }],
                checked_at: new Date().toISOString() })
        },
        facts: { record: async () => ({}) }
    });
    const result = await service.verifyConnector({ projectId: 10, taskId: 1002,
        actorId: 'user:2', idempotencyKey: 'dzen1002-preflight-test' }) as any;
    assert.equal(result.inventory.classification, 'absent');
    assert.equal(result.inventory.coverage_complete, true);
    assert.equal(result.inventory.provider_channel_id, DZEN1002_ROUTE.providerChannelId);
    assert.equal(events.length, 1);
});
