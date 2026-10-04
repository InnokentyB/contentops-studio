import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseDzenTask } from '../services/dzen_owner_release.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const bodyHash = '504fcf33789b740be15646c46209b07d39fc8bb6ed75870f32c09e3754266e9c';
const manifestChecksum = `sha256:${'a'.repeat(64)}`;
const schedule = '2026-10-04T09:00:00.000Z';

function harness(taskOverrides: Record<string, unknown> = {}) {
    const task = {
        id: 1018, project_id: 10, channel_id: 116,
        channel: { type: 'dzen', name: 'analystcraft_dzen' },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'approval_required',
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', draft_text: 'accepted dzen body',
        visual_mode: 'auto_assess', visual_state: 'NO_VISUAL_NEEDED', visual_placement: 'article_cover',
        visual_decision_version: 1, selected_asset_id: null, selected_asset: null,
        schedule_at: new Date(schedule), publish_at: new Date(schedule),
        publication_fact: null, published_link: null, ...taskOverrides
    };
    const events: Array<Record<string, unknown>> = [];
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: {
            findFirst: async () => null,
            create: async ({ data }: { data: Record<string, unknown> }) => (events.push(data), data)
        },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ data }: { data: Record<string, unknown> }) => (Object.assign(task, data), { count: 1 })
        },
        artDirectionDecision: { findFirst: async () => ({
            id: 196, decision_version: 1, decision: 'NO_VISUAL_NEEDED', source_content_revision: 1,
            channel: 'dzen', placement: 'article_cover', status: 'active'
        }) },
        deliveryAttempt: { findFirst: async () => null }
    };
    return {
        task, events,
        deps: {
            transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
            getManifestChecksum: async () => manifestChecksum,
            hashBody: () => bodyHash
        }
    };
}

const args = {
    projectId: 10, taskId: 1018, actorId: 'user:2', expectedChannelId: 116,
    expectedContentRevision: 1, expectedAcceptedRevision: 1, expectedBodySha256: bodyHash,
    expectedVisualState: 'NO_VISUAL_NEEDED' as const, expectedPlacement: 'article_cover',
    expectedVisualDecisionVersion: 1, expectedSelectedAssetId: null, expectedAssetSha256: null,
    expectedScheduleAt: schedule, expectedPublishAt: schedule, expectedManifestChecksum: manifestChecksum,
    approvalReference: 'Portfolio HQ owner approval 2026-10-04 for Dzen task 1018',
    idempotencyKey: 'dzen-owner-release-1018-r1-20261004-v1'
};

test('generic Dzen release authorizes one exact accepted package without publishing', async () => {
    const h = harness();
    const result = await releaseDzenTask(h.deps, args);
    assert.equal(result.publication_mode, 'owner_released');
    assert.equal(result.explicit_send_required, true);
    assert.equal(result.published, false);
    assert.equal(h.task.publication_mode, 'owner_released');
    assert.equal(h.events[0].command, 'ba_release_approved_dzen_task');
});

test('generic Dzen release fails closed on revision, body, visual, fact or manifest drift', async () => {
    await assert.rejects(() => releaseDzenTask(harness({ accepted_revision: null }).deps, args), /DZEN_OWNER_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseDzenTask(harness({ visual_decision_version: 2 }).deps, args), /DZEN_OWNER_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseDzenTask(harness({ publication_fact: { id: 1 } }).deps, args), /DZEN_OWNER_RELEASE_GUARD_FAILED/);
    await assert.rejects(() => releaseDzenTask(harness().deps, { ...args, expectedBodySha256: 'b'.repeat(64) }), /DZEN_OWNER_RELEASE_GUARD_FAILED/);
    const stale = harness();
    stale.deps.getManifestChecksum = async () => `sha256:${'c'.repeat(64)}`;
    await assert.rejects(() => releaseDzenTask(stale.deps, args), /STALE_MANIFEST/);
});

test('generic Dzen owner release is not delegated to Publisher or SMM profiles', () => {
    const tool = 'ba_release_approved_dzen_task';
    assert.equal(isToolAllowedForProfile('owner', tool), true);
    assert.equal(isToolAllowedForProfile('publisher', tool), false);
    assert.equal(isToolAllowedForProfile('planner', tool), false);
});
