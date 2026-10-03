import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseLinkedInBrowserTask } from '../services/linkedin_browser_owner_release.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const bodyHash = '4ead1918d3caefebacdc336372c639e4758bb0a5674cb7965baa29a6db9ac1e7';
const assetHash = '2a5431fec64e6d6f92cd0a12c690ce78ca0793b5c1ef3708fec88195302568b3';
const manifestChecksum = `sha256:${'a'.repeat(64)}`;
const schedule = '2026-10-02T11:00:00.000Z';

function harness(overrides: Record<string, unknown> = {}) {
    const task = {
        id: 991, project_id: 7, week_package_id: 51, item_key: 'seturon-linkedin-991',
        channel_id: 6, channel: { type: 'linkedin', name: 'seturon_linkedin_page' },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', draft_text: 'accepted body',
        visual_mode: 'auto_assess', visual_state: 'APPROVED', visual_placement: 'feed',
        selected_asset_id: 107, selected_asset: { id: 107, status: 'approved', content_revision: 1,
            file_url: 'https://cdn.example/107.png', provenance: { planner_storage: { sha256: assetHash } } },
        schedule_at: new Date(schedule), publish_at: new Date(schedule), publication_fact: null,
        published_link: null, quality_report: { handoff_bundle: { task: { id: 991 } } }, ...overrides
    };
    const events: Array<Record<string, unknown>> = [];
    const workItems: Array<Record<string, unknown>> = [];
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => (events.push(data), { id: 1, ...data })
        },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ data }: { data: Record<string, unknown> }) => (Object.assign(task, data), { count: 1 })
        },
        deliveryAttempt: { findFirst: async () => null },
        workItem: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const item = { id: 2001, ...data };
                workItems.push(item);
                return item;
            }
        }
    };
    const deps = {
        transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
        getManifestChecksum: async () => manifestChecksum,
        hashBody: () => bodyHash
    };
    return { task, events, workItems, deps };
}

const args = {
    projectId: 7, taskId: 991, actorId: 'user:2', expectedChannelId: 6,
    expectedContentRevision: 1, expectedAcceptedRevision: 1, expectedBodySha256: bodyHash,
    expectedSelectedAssetId: 107, expectedAssetSha256: assetHash,
    expectedScheduleAt: schedule, expectedManifestChecksum: manifestChecksum,
    approvalReference: 'Portfolio HQ owner approval 2026-10-03',
    idempotencyKey: 'linkedin-browser-release-991-r1-a107-v1'
};

test('owner release creates exactly one revision-bound browser publication item without sending', async () => {
    const h = harness();
    const result = await releaseLinkedInBrowserTask(h.deps, args);
    assert.equal(result.publication_authorized, true);
    assert.equal(result.browser_work_item_id, 2001);
    assert.equal(h.task.status, 'browser_required');
    assert.equal(h.task.publication_mode, 'browser_required');
    assert.equal(h.workItems.length, 1);
    assert.equal(h.workItems[0].dedupe_key, 'browser_publish:991:r1');
    assert.equal(h.events[0].command, 'ba_release_approved_linkedin_browser_task');
});

test('release fails closed on revision, asset, fact or manifest drift', async () => {
    await assert.rejects(() => releaseLinkedInBrowserTask(harness({ accepted_revision: null }).deps, args), /OWNER_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseLinkedInBrowserTask(harness({ selected_asset_id: 108 }).deps, args), /OWNER_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseLinkedInBrowserTask(harness({ publication_fact: { id: 1 } }).deps, args), /OWNER_RELEASE_GUARD_FAILED/);
    const stale = harness();
    stale.deps.getManifestChecksum = async () => `sha256:${'b'.repeat(64)}`;
    await assert.rejects(() => releaseLinkedInBrowserTask(stale.deps, args), /STALE_MANIFEST/);
});

test('LinkedIn browser release remains owner-only', () => {
    const tool = 'ba_release_approved_linkedin_browser_task';
    assert.equal(isToolAllowedForProfile('owner', tool), true);
    for (const profile of ['publisher', 'planner', 'writer', 'editor', 'art_director', 'growth_analyst'] as const) {
        assert.equal(isToolAllowedForProfile(profile, tool), false, `${profile} must not release owner authority`);
    }
});
