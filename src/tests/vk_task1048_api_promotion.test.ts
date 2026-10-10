import test from 'node:test';
import assert from 'node:assert/strict';
import { previewVkTask1048Api, promoteVkTask1048Api, VK1048_MANIFEST } from '../services/vk_task1048_api_promotion.service';

function fixture(ready: boolean) {
    const task: any = { id: 1048, project_id: 10, channel_id: 117,
        channel: { id: 117, name: 'analystcraft_vk_group', type: 'vk', is_active: true,
            config: ready ? { vk_id: '-240051152', publish_access_token: 'community', user_access_token: 'user' } : { vk_id: '-240051152' } },
        status: 'browser_required', publication_mode: 'browser_required', content_revision: 1, accepted_revision: 1,
        text_state: 'accepted', handoff_state: 'ready', visual_state: 'APPROVED', visual_placement: 'article_cover',
        visual_decision_version: 1, selected_asset_id: 130, draft_text: 'body',
        selected_asset: { id: 130, status: 'approved', content_revision: 1, file_url: 'https://cdn.test/130.png',
            provenance: { planner_storage: { sha256: '1e7ef29ec003f18c242af5ca4d15d9f4990539ed905398a14df0d3071b4aa81e' } } },
        schedule_at: new Date('2026-10-10T12:00:00.000Z'), publish_at: new Date('2026-10-10T12:00:00.000Z'),
        publication_fact: null, published_link: null };
    const browser: any = { id: 1699, state: 'available' };
    let event: any = null;
    const db: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => task, updateMany: async ({ data }: any) => (Object.assign(task, data), { count: 1 }) },
        workItem: { findFirst: async () => browser.state === 'available' ? browser : null,
            updateMany: async ({ data }: any) => (Object.assign(browser, data), { count: 1 }) },
        deliveryAttempt: { findFirst: async () => null },
        artDirectionDecision: { findFirst: async () => ({ id: 268 }) },
        workflowEvent: { findFirst: async () => event, create: async ({ data }: any) => { event = data; } },
        $transaction: async (run: any) => run(db)
    };
    return { db, task, browser };
}

const args = { projectId: 10 as const, taskId: 1048 as const, actorId: 'user:2',
    expectedManifestChecksum: VK1048_MANIFEST, approvalReference: 'owner approves exact VK API promotion',
    idempotencyKey: 'vk1048-api-promotion-v1' } as const;
const deps = { hashBody: () => '5cc11b6f7a5d8a2abf7a10ca2d005bf6cdd1c010a97ebedcd49e1092d5b874ab',
    manifestLoader: async () => ({ checksum: VK1048_MANIFEST }) as never };

test('VK1048 preview reports missing publishing credentials without mutating or calling a provider', async () => {
    const f = fixture(false);
    const preview = await previewVkTask1048Api(args, f.db, deps);
    assert.equal(preview.connector_ready, false);
    assert.equal(preview.connector_reason, 'vk_credentials_missing');
    assert.equal(f.task.status, 'browser_required');
    await assert.rejects(promoteVkTask1048Api(args, f.db, deps),
        /VK1048_CONNECTOR_NOT_READY/);
    assert.equal(f.browser.state, 'available');
});

test('VK1048 promotion atomically cancels only the unclaimed browser item and is replay-safe', async () => {
    const f = fixture(true);
    const first = await promoteVkTask1048Api(args, f.db, deps);
    const replay = await promoteVkTask1048Api(args, f.db, deps);
    assert.equal(first.published, false);
    assert.equal(f.task.status, 'ready_for_execution');
    assert.equal(f.task.publication_mode, 'connector_auto');
    assert.equal(f.browser.state, 'cancelled');
    assert.equal(replay.replayed, true);
});
