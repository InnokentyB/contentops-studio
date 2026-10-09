import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseVkBrowserTask, VkBrowserReleaseArgs, VkBrowserReleaseDependencies } from '../services/vk_browser_owner_release.service';

const hash = 'a'.repeat(64);
const schedule = '2026-10-09T11:00:00.000Z';
const args: VkBrowserReleaseArgs = {
    projectId: 10, taskId: 2000, actorId: 'user:2', expectedChannelId: 117,
    expectedContentRevision: 2, expectedAcceptedRevision: 2, expectedBodySha256: hash,
    expectedSelectedAssetId: 200, expectedAssetSha256: hash, expectedPlacement: 'clip',
    expectedScheduleAt: schedule, expectedManifestChecksum: `sha256:${hash}`,
    approvalReference: 'fixture:exact-clip-owner-approval', idempotencyKey: 'fixture:clip:2000:r2'
};
function harness(options: { role?: string; priorAttempt?: boolean; fact?: boolean; placement?: string;
    metadata?: Record<string, unknown> } = {}) {
    const writes: Record<string, unknown>[] = [];
    const task = {
        id: 2000, project_id: 10, week_package_id: 61, item_key: 'clip-2000',
        channel_id: 117, channel: { type: 'vk', name: 'vk_group', config: { vk_id: '-240051152' } },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
        content_revision: 2, accepted_revision: 2, text_state: 'accepted', title: 'Clip', draft_text: 'Exact caption',
        visual_state: 'APPROVED', visual_placement: options.placement || 'clip', selected_asset_id: 200,
        selected_asset: { id: 200, status: 'approved', content_revision: 2,
            file_url: 'https://example.com/clip.mp4', provenance: { planner_storage: options.metadata || {
                mime_type: 'video/mp4', sha256: hash, byte_size: 1234, width: 1080, height: 1920 } } },
        schedule_at: new Date(schedule), publish_at: new Date(schedule),
        publication_fact: options.fact ? { id: 1 } : null, published_link: null, quality_report: {}
    };
    const tx = {
        projectMember: { findUnique: async () => ({ role: options.role || 'owner' }) },
        workflowEvent: { findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { id: 1 }; } },
        contentItem: { findFirst: async () => task,
            updateMany: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { count: 1 }; } },
        deliveryAttempt: { findFirst: async () => options.priorAttempt ? { id: 1 } : null },
        workItem: { findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return { id: 44 }; } }
    };
    const deps: VkBrowserReleaseDependencies = { transaction: async callback => callback(tx),
        getManifestChecksum: async () => args.expectedManifestChecksum, hashBody: () => hash };
    return { deps, writes };
}

test('exact owner release queues approved Clip while preserving the explicit clip placement', async () => {
    const h = harness();
    const result = await releaseVkBrowserTask(h.deps, args);
    assert.equal(result.placement, 'clip');
    assert.equal(result.published, false);
    assert.equal(result.browser_work_item_id, 44);
    const work = h.writes.find(write => write.kind === 'browser_publish');
    assert.equal((work?.result_payload as Record<string, unknown>).placement, 'clip');
});

test('Clip release refuses ordinary feed conversion, non-owner, prior attempt and existing publication', async () => {
    for (const options of [{ placement: 'feed' }, { role: 'writer' }, { priorAttempt: true }, { fact: true }]) {
        const h = harness(options);
        await assert.rejects(() => releaseVkBrowserTask(h.deps, args));
        assert.equal(h.writes.length, 0);
    }
});

test('Clip release blocks image, missing size, and nonportrait editorial assets before queueing', async () => {
    for (const metadata of [
        { mime_type: 'image/jpeg', sha256: hash, byte_size: 1234, width: 1080, height: 1920 },
        { mime_type: 'video/mp4', sha256: hash, width: 1080, height: 1920 },
        { mime_type: 'video/mp4', sha256: hash, byte_size: 1234, width: 1920, height: 1080 }
    ]) {
        const h = harness({ metadata });
        await assert.rejects(() => releaseVkBrowserTask(h.deps, args), /VK_CLIP_/);
        assert.equal(h.writes.length, 0);
    }
});
