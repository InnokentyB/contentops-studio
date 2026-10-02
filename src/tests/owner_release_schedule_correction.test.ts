import test from 'node:test';
import assert from 'node:assert/strict';
import { correctOwnerReleasedTaskSchedule } from '../services/owner_targeted_release_operations';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const bodyHash = '9e204bfe24014d6c933f047316e92bdb106cb362f24ac57e25cc1c9903594fa8';
const manifestChecksum = `sha256:${'a'.repeat(64)}`;
const oldSchedule = '2026-10-02T19:30:00.000Z';
const newSchedule = '2026-10-02T09:30:00.000Z';

function harness(overrides: Record<string, unknown> = {}, hasAttempt = false, releaseOverrides: Record<string, unknown> = {}) {
    const task = {
        id: 1012, project_id: 10, channel_id: 111, channel: { type: 'telegram' },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted', draft_text: 'body',
        visual_placement: 'feed', visual_mode: 'required', visual_state: 'APPROVED',
        selected_asset_id: 99, selected_asset: { id: 99, status: 'approved', content_revision: 1, file_url: 'https://cdn.example/99.png' },
        status: 'ready_for_execution', handoff_state: 'ready', publication_mode: 'owner_released',
        schedule_at: new Date(oldSchedule), publish_at: new Date(oldSchedule), publication_fact: null,
        published_link: null, ...overrides
    };
    const events: Array<{ data: Record<string, unknown> }> = [];
    const tx = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: {
            findFirst: async ({ where }: { where: { command: string } }) => where.command === 'ba_release_approved_telegram_task'
                ? { after_state: { task_id: 1012, channel_id: 111, content_revision: 1, accepted_revision: 1,
                    schedule_at: oldSchedule, body_sha256: bodyHash, placement: 'feed', publication_mode: 'owner_released',
                    ...releaseOverrides } }
                : null,
            create: async (event: { data: Record<string, unknown> }) => (events.push(event), event)
        },
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: { where: { schedule_at: Date; publication_mode: string }; data: Record<string, unknown> }) => {
                if (task.schedule_at.getTime() !== where.schedule_at.getTime() || task.publication_mode !== where.publication_mode) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            }
        },
        deliveryAttempt: { findFirst: async () => hasAttempt ? { id: 7, state: 'unknown' } : null }
    };
    const deps = {
        db: { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) },
        hashBody: () => bodyHash,
        requireOwner: async () => undefined,
        getManifestChecksum: async () => manifestChecksum
    };
    return { task, events, deps };
}

const args = {
    projectId: 10, actorId: 'user:2', taskId: 1012, expectedChannelId: 111,
    expectedContentRevision: 1, expectedAcceptedRevision: 1, expectedSelectedAssetId: 99,
    expectedVisualMode: 'required', expectedVisualState: 'APPROVED', expectedPlacement: 'feed' as const,
    expectedScheduleAt: oldSchedule, expectedPublishAt: oldSchedule,
    newScheduleAt: newSchedule, newPublishAt: newSchedule,
    expectedBodySha256: bodyHash, expectedManifestChecksum: manifestChecksum,
    correctionReference: 'owner-command:correct-task-1012-time', idempotencyKey: 'correct-task-1012-time-v1'
};

test('generic owner-release correction supersedes proof and changes only schedule authority fields', async () => {
    const { task, events, deps } = harness();
    const before = structuredClone(task);
    const result = await correctOwnerReleasedTaskSchedule(deps, args);

    assert.equal(task.schedule_at.toISOString(), newSchedule);
    assert.equal(task.publish_at.toISOString(), newSchedule);
    assert.equal(task.publication_mode, 'approval_required');
    assert.equal(task.content_revision, before.content_revision);
    assert.equal(task.accepted_revision, before.accepted_revision);
    assert.equal(task.channel_id, before.channel_id);
    assert.equal(task.selected_asset_id, before.selected_asset_id);
    assert.equal(result.release_superseded, true);
    assert.equal(result.fresh_owner_release_required, true);
    assert.equal(events[0].data.command, 'ba_correct_owner_released_task_schedule');
});

test('correction fails closed on stale manifest, provider attempt, fact, or CAS drift', async () => {
    const stale = harness();
    stale.deps.getManifestChecksum = async () => `sha256:${'b'.repeat(64)}`;
    await assert.rejects(() => correctOwnerReleasedTaskSchedule(stale.deps, args), /STALE_MANIFEST/);

    const attempted = harness({}, true);
    await assert.rejects(() => correctOwnerReleasedTaskSchedule(attempted.deps, args), /DELIVERY_ATTEMPT_EXISTS/);

    const fact = harness({ publication_fact: { id: 1 } });
    await assert.rejects(() => correctOwnerReleasedTaskSchedule(fact.deps, args), /SCHEDULE_CORRECTION_GUARD_FAILED/);

    const drift = harness({ selected_asset_id: 100 });
    await assert.rejects(() => correctOwnerReleasedTaskSchedule(drift.deps, args), /SCHEDULE_CORRECTION_GUARD_FAILED/);

    const staleProof = harness({}, false, { body_sha256: '0'.repeat(64) });
    await assert.rejects(() => correctOwnerReleasedTaskSchedule(staleProof.deps, args), /OWNER_RELEASE_PROOF_MISMATCH/);
});

test('schedule correction is exposed only to owner and publisher capability profiles', () => {
    const tool = 'ba_correct_owner_released_task_schedule';
    assert.equal(isToolAllowedForProfile('owner', tool), true);
    assert.equal(isToolAllowedForProfile('publisher', tool), true);
    assert.equal(isToolAllowedForProfile('planner', tool), false);
    assert.equal(isToolAllowedForProfile('writer', tool), false);
});
