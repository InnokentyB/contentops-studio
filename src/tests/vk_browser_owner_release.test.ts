import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseVkBrowserTask } from '../services/vk_browser_owner_release.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const bodyHash = '7b379d871673a4be2fda7eaed50282fc950a1bbeb0f07661e77a2dd369d08628';
const assetHash = '27ea57995f4737c1bd38b28ab1d2f47389aa4243d8c25a1ce90531819b95d071';
const manifestChecksum = `sha256:${'d'.repeat(64)}`;
const schedule = '2026-10-04T11:00:00.000Z';

function harness(overrides: Record<string, unknown> = {}, membershipRole = 'owner') {
    const task = {
        id: 1019, project_id: 10, week_package_id: 61, item_key: 'vk-task-1019',
        channel_id: 117, channel: { type: 'vk', name: 'analystcraft_vk_group', config: { vk_id: '-240051152' } },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', title: 'accepted title', draft_text: 'accepted body',
        visual_state: 'APPROVED', visual_placement: 'feed', selected_asset_id: 104,
        selected_asset: { id: 104, status: 'approved', content_revision: 1,
            file_url: 'https://cdn.example/104.jpg', provenance: { planner_storage: { sha256: assetHash } } },
        schedule_at: new Date(schedule), publish_at: new Date(schedule), publication_fact: null,
        published_link: null, quality_report: {}, ...overrides
    };
    const events: any[] = [];
    const workItems: any[] = [];
    const tx: any = {
        projectMember: { findUnique: async () => ({ role: membershipRole }) },
        workflowEvent: {
            findFirst: async () => null,
            create: async ({ data }: any) => (events.push(data), { id: 1, ...data })
        },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ data }: any) => (Object.assign(task, data), { count: 1 })
        },
        deliveryAttempt: { findFirst: async () => null },
        workItem: {
            findFirst: async () => null,
            create: async ({ data }: any) => {
                const item = { id: 3001, ...data };
                workItems.push(item);
                return item;
            }
        }
    };
    return {
        task, events, workItems,
        deps: {
            transaction: async (callback: any) => callback(tx),
            getManifestChecksum: async () => manifestChecksum,
            hashBody: () => bodyHash
        }
    };
}

const args = {
    projectId: 10, taskId: 1019, actorId: 'user:2', expectedChannelId: 117,
    expectedContentRevision: 1, expectedAcceptedRevision: 1, expectedBodySha256: bodyHash,
    expectedSelectedAssetId: 104, expectedAssetSha256: assetHash,
    expectedScheduleAt: schedule, expectedManifestChecksum: manifestChecksum,
    approvalReference: 'Owner approval for VK task 1019',
    idempotencyKey: 'vk-browser-release-1019-r1-a104-v1'
};

test('owner release creates one exact VK browser work item without contacting VK', async () => {
    const h = harness();
    const result = await releaseVkBrowserTask(h.deps as any, args);
    assert.equal(result.publication_authorized, true);
    assert.equal(result.browser_work_item_id, 3001);
    assert.equal(h.task.status, 'browser_required');
    assert.equal(h.task.publication_mode, 'browser_required');
    assert.equal(h.workItems.length, 1);
    assert.equal(h.workItems[0].dedupe_key, 'browser_publish:1019:r1');
    assert.equal(h.workItems[0].result_payload.approval_reference, args.approvalReference);
    assert.equal(h.events[0].command, 'ba_release_approved_vk_browser_task');
});

test('owner release preserves the exact article, video or Story placement in the browser lease', async () => {
    for (const placement of ['article_cover', 'video_cover', 'story'] as const) {
        const h = harness({ visual_placement: placement });
        const result = await releaseVkBrowserTask(h.deps as any, {
            ...args,
            expectedPlacement: placement,
            ...(['article_cover', 'video_cover'].includes(placement) ? { expectedTitleSha256: bodyHash } : {}),
            idempotencyKey: `${args.idempotencyKey}:${placement}`
        });
        assert.equal(result.placement, placement);
        assert.equal(h.workItems[0].result_payload.placement, placement);
        assert.equal((h.task.quality_report as any).owner_release.placement, placement);
    }
});

test('VK release fails closed on owner, revision, asset, fact and manifest drift', async () => {
    await assert.rejects(() => releaseVkBrowserTask(harness({}, 'editor').deps as any, args), /OWNER_REQUIRED/);
    await assert.rejects(() => releaseVkBrowserTask(harness({ accepted_revision: null }).deps as any, args), /OWNER_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseVkBrowserTask(harness({ selected_asset_id: 105 }).deps as any, args), /OWNER_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseVkBrowserTask(harness({ publication_fact: { id: 1 } }).deps as any, args), /OWNER_RELEASE_GUARD_FAILED/);
    const stale = harness();
    stale.deps.getManifestChecksum = async () => `sha256:${'e'.repeat(64)}`;
    await assert.rejects(() => releaseVkBrowserTask(stale.deps as any, args), /STALE_MANIFEST/);
});

test('Publisher can request VK browser release while the service keeps the owner membership guard', () => {
    assert.equal(isToolAllowedForProfile('owner', 'ba_release_approved_vk_browser_task'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_vk_browser_task'), true);
    for (const tool of [
        'ba_claim_vk_browser_publication',
        'ba_start_vk_browser_submission',
        'ba_confirm_vk_browser_submission',
        'ba_mark_vk_browser_submission_uncertain'
    ]) {
        assert.equal(isToolAllowedForProfile('publisher', tool), true, tool);
        assert.equal(isToolAllowedForProfile('writer', tool), false, tool);
    }
});
