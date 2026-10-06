import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyVkBrowserPreProviderRecovery,
    previewVkBrowserPreProviderRecovery
} from '../services/vk_browser_pre_provider_recovery.service';

function harness() {
    const state: any = {
        membership: { role: 'owner' },
        task: {
            id: 1019,
            project_id: 10,
            channel_id: 117,
            status: 'publishing',
            publication_mode: 'browser_required',
            content_revision: 1,
            accepted_revision: 1,
            text_state: 'accepted',
            visual_state: 'APPROVED',
            draft_text: 'Accepted VK body',
            selected_asset_id: 104,
            selected_asset: {
                status: 'approved',
                content_revision: 1,
                provenance: { planner_storage: { sha256: 'b'.repeat(64) } }
            },
            channel: { type: 'vk' },
            publication_fact: null,
            published_link: null
        },
        workItem: {
            id: 1516,
            project_id: 10,
            content_item_id: 1019,
            kind: 'browser_publish',
            assignee_role: 'browser_publisher',
            state: 'claimed',
            lease_token: 'private-lease',
            lease_actor_id: 'user:2',
            lease_expires_at: new Date('2026-10-06T13:00:00.000Z')
        },
        attempt: {
            id: 28,
            project_id: 10,
            content_item_id: 1019,
            channel_id: 117,
            mode: 'assisted',
            status: 'pending',
            attempt_number: 1,
            requires_manual_confirmation: true,
            error_message: '[VK_BROWSER_SUBMIT_UNCERTAIN]'
        },
        uncertainEvent: {
            id: 70,
            command: 'ba_mark_vk_browser_submission_uncertain',
            after_state: {
                delivery_attempt_id: 28,
                retry_allowed: false,
                reason_code: '[VK_BROWSER_SUBMIT_UNCERTAIN]'
            }
        },
        events: [] as any[]
    };
    const tx: any = {
        projectMember: { findUnique: async () => state.membership },
        contentItem: {
            findFirst: async () => state.task,
            updateMany: async ({ data }: any) => {
                Object.assign(state.task, data);
                return { count: 1 };
            }
        },
        workItem: {
            findFirst: async () => state.workItem,
            updateMany: async ({ data }: any) => {
                Object.assign(state.workItem, data);
                return { count: 1 };
            }
        },
        deliveryAttempt: {
            findFirst: async () => state.attempt,
            updateMany: async ({ data }: any) => {
                Object.assign(state.attempt, data);
                return { count: 1 };
            }
        },
        workflowEvent: {
            findFirst: async ({ where }: any) => {
                if (where.command === 'ba_apply_vk_browser_pre_provider_recovery') {
                    return state.events.find((event: any) => event.idempotency_key === where.idempotency_key) || null;
                }
                return state.uncertainEvent;
            },
            create: async ({ data }: any) => {
                const event = { id: 100 + state.events.length, ...data };
                state.events.push(event);
                return event;
            }
        }
    };
    const dependencies: any = {
        transaction: async (callback: any) => callback(tx),
        hashBody: () => 'a'.repeat(64)
    };
    return { state, dependencies };
}

const guards = {
    projectId: 10,
    taskId: 1019,
    actorId: 'user:2',
    expectedChannelId: 117,
    expectedContentRevision: 1,
    expectedAcceptedRevision: 1,
    expectedBodySha256: 'a'.repeat(64),
    expectedSelectedAssetId: 104,
    expectedAssetSha256: 'b'.repeat(64),
    expectedWorkItemId: 1516,
    expectedFailureCode: '[VK_BROWSER_SUBMIT_UNCERTAIN]'
};

test('VK pre-provider recovery preview returns an exact no-provider bounded diff', async () => {
    const h = harness();
    const preview = await previewVkBrowserPreProviderRecovery(h.dependencies, guards);
    assert.equal(preview.attempt_id, 28);
    assert.equal(preview.before.task_status, 'publishing');
    assert.equal(preview.after.task_status, 'browser_required');
    assert.equal(preview.after.attempt_status, 'failed');
    assert.equal(preview.provider_contact, false);
    assert.equal(preview.publication_fact_created, false);
    assert.match(preview.preview_token, /^sha256:[a-f0-9]{64}$/);
    assert.equal(h.state.events.length, 0);
});

test('VK pre-provider recovery apply atomically rearms the same work item and is idempotent', async () => {
    const h = harness();
    const preview = await previewVkBrowserPreProviderRecovery(h.dependencies, guards);
    const args = {
        ...guards,
        expectedAttemptId: 28,
        previewToken: preview.preview_token,
        reason: 'Confirmed from local worker trace: composer failed before text or image upload.',
        idempotencyKey: 'vk-browser-pre-provider-recovery:10:1019:attempt-28'
    };
    const applied = await applyVkBrowserPreProviderRecovery(h.dependencies, args);
    assert.equal(applied.replayed, false);
    assert.equal(h.state.task.status, 'browser_required');
    assert.equal(h.state.attempt.status, 'failed');
    assert.equal(h.state.attempt.requires_manual_confirmation, false);
    assert.equal(h.state.workItem.state, 'available');
    assert.equal(h.state.workItem.lease_token, null);
    assert.equal(h.state.task.publication_fact, null);

    const replay = await applyVkBrowserPreProviderRecovery(h.dependencies, args);
    assert.equal(replay.replayed, true);
    assert.equal(h.state.events.length, 1);
    await assert.rejects(
        applyVkBrowserPreProviderRecovery(h.dependencies, {
            ...args,
            reason: 'A different recovery reason must not reuse the same idempotency key.'
        }),
        /IDEMPOTENCY_CONFLICT/
    );
});

test('VK pre-provider recovery rejects stale attempt evidence with zero writes', async () => {
    const h = harness();
    h.state.attempt.error_message = '[VK_BROWSER_READBACK_UNCONFIRMED]';
    await assert.rejects(
        previewVkBrowserPreProviderRecovery(h.dependencies, guards),
        /VK_BROWSER_PRE_PROVIDER_RECOVERY_ATTEMPT_GUARD_FAILED/
    );
    assert.equal(h.state.task.status, 'publishing');
    assert.equal(h.state.workItem.state, 'claimed');
    assert.equal(h.state.events.length, 0);
});
