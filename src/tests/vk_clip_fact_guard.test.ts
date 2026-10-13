import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { guardVkClipFactWrite, type VkClipFactGuard } from '../services/vk_clip_fact_guard';
import { publicationMetricCollectionPolicy } from '../services/publication_fact.service';

const date = new Date('2026-10-09T10:00:00.000Z');
const sha = (body: string) => createHash('sha256').update(body).digest('hex');
const guard: VkClipFactGuard = { channelId: 120, expectedOwnerId: '-240051152', workItemId: 42, leaseToken: 'test-lease',
    approvalReference: 'owner-approved-test', idempotencyKey: 'clip-test-r1', contentRevision: 1,
    textSha256: sha('Caption'), imageSha256: 'a'.repeat(64), selectedAssetId: 98,
    attemptId: 51, expectedUpdatedAt: date.toISOString() };
function harness(change: Record<string, unknown> = {}, casCount = 1, boundaries: { work?: Record<string, unknown>; asset?: Record<string, unknown>; attempt?: Record<string, unknown> } = {}) {
    const writes: string[] = [];
    const task = { id: 900, project_id: 10, channel_id: 120, status: 'publishing',
        publication_mode: 'browser_required', visual_placement: 'clip', visual_state: 'APPROVED', content_revision: 1,
        accepted_revision: 1, text_state: 'accepted', selected_asset_id: 98, draft_text: 'Caption',
        title: '', updated_at: date, published_link: null, publication_fact: null,
        channel: { id: 120, type: 'vk', is_active: true, config: { vk_id: '-240051152' }, updated_at: date }, ...change };
    const release = { publication_authorized: true, approval_reference: guard.approvalReference,
        content_revision: 1, body_sha256: guard.textSha256, selected_asset_id: 98,
        asset_sha256: guard.imageSha256, placement: 'clip', channel_id: 120 };
    const tx = { socialChannel: { updateMany: async () => { writes.push('channel'); return { count: 1 }; } }, contentItem: { findFirst: async () => task, updateMany: async () => { writes.push('task'); return { count: casCount }; } },
        workItem: { findFirst: async () => ({ id: 42, project_id: 10, content_item_id: 900,
            kind: 'browser_publish', assignee_role: 'browser_publisher', state: 'claimed',
            lease_token: guard.leaseToken, lease_actor_id: 'user:2', lease_expires_at: new Date('2099-01-01'),
            updated_at: date, result_payload: release, ...boundaries.work }), updateMany: async () => { writes.push('lease'); return { count: 1 }; } },
        imageAsset: { findFirst: async () => ({ id: 98, project_id: 10, content_revision: 1, status: 'approved',
            updated_at: date, file_url: 'https://cdn.example/clip.mp4', provenance: { planner_storage: { sha256: guard.imageSha256, mime_type: 'video/mp4', byte_size: 1000, width: 1080, height: 1920 } }, ...boundaries.asset }),
            updateMany: async () => { writes.push('asset'); return { count: 1 }; } },
        deliveryAttempt: { findFirst: async () => ({ id: 51, project_id: 10, content_item_id: 900,
            channel_id: 120, idempotency_key: guard.idempotencyKey, status: 'pending', updated_at: date, ...boundaries.attempt }),
            updateMany: async () => { writes.push('attempt'); return { count: 1 }; } } };
    return { tx: tx as unknown as Prisma.TransactionClient, writes };
}
const identity = { projectId: 10, taskId: 900, actorId: 'user:2' };
test('clip fact transaction locks exact accepted task, approved asset, attempt and live lease', async () => {
    const h = harness();
    await guardVkClipFactWrite(h.tx, identity, guard);
    assert.deepEqual(h.writes.sort(), ['asset', 'attempt', 'channel', 'lease', 'task']);
});
test('clip fact rejects changed revision, route, snapshot and approval before fact creation', async () => {
    for (const change of [{ accepted_revision: 2 }, { visual_placement: 'video_cover' },
        { updated_at: new Date('2026-10-09T10:00:01Z') }, { draft_text: 'Changed caption' },
        { visual_state: 'PENDING' }, { selected_asset_id: 99 },
        { channel: { type: 'vk', is_active: true, config: { vk_id: '-555' } } }, { published_link: 'https://vk.com/clip-1_2' },
        { status: 'cancelled' }, { channel: { type: 'vk', is_active: false } }]) {
        const h = harness(change);
        await assert.rejects(guardVkClipFactWrite(h.tx, identity, guard), /VK_CLIP_FACT_GUARD/);
        assert.deepEqual(h.writes, []);
    }
});
test('clip fact CAS conflict blocks the write', async () => {
    await assert.rejects(guardVkClipFactWrite(harness({}, 0).tx, identity, guard), /VK_CLIP_FACT_CAS/);
});
test('VK Clip metrics stay manual while ordinary VK video uses provider API', () => {
    assert.deepEqual(publicationMetricCollectionPolicy({ channel: { type: 'vk' }, visual_placement: 'clip' }),
        { automatic: false, collection_mode: 'manual', source: 'manual' });
    assert.deepEqual(publicationMetricCollectionPolicy({ channel: { type: 'vk' }, visual_placement: 'video_cover' }),
        { automatic: true, collection_mode: 'automatic', source: 'provider_api' });
});

test('clip fact refuses lost lease, uncertain attempt or changed approved media', async () => {
    for (const boundary of [
        { work: { lease_token: 'different-lease' } }, { work: { lease_actor_id: 'user:3' } },
        { work: { lease_expires_at: new Date('2000-01-01') } },
        { work: { result_payload: { publication_authorized: false } } },
        { attempt: { status: 'failed' } }, { asset: { status: 'rejected' } },
        { asset: { provenance: { planner_storage: { sha256: 'b'.repeat(64) } } } }
    ]) {
        const h = harness({}, 1, boundary);
        await assert.rejects(guardVkClipFactWrite(h.tx, identity, guard), /VK_CLIP_FACT_GUARD/);
        assert.deepEqual(h.writes, []);
    }
});
test('clip fact rechecks MP4 metadata inside the transaction', async () => {
    const h = harness({}, 1, { asset: { provenance: { planner_storage: {
        sha256: guard.imageSha256, mime_type: 'video/mp4', byte_size: 1000, width: 1920, height: 1080
    } } } });
    await assert.rejects(guardVkClipFactWrite(h.tx, identity, guard), /VK_CLIP_PORTRAIT_ASSET_REQUIRED/);
    assert.deepEqual(h.writes, []);
});
