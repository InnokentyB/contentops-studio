import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyVkBrowserPreSubmitRecovery,
    previewVkBrowserPreSubmitRecovery
} from '../services/vk_browser_pre_submit_recovery.service';

function harness() {
    const state: any = {
        task: {
            id: 1019, project_id: 10, channel_id: 117, status: 'browser_required',
            publication_mode: 'browser_required', content_revision: 1, accepted_revision: 1,
            text_state: 'accepted', visual_state: 'APPROVED', draft_text: 'accepted',
            selected_asset_id: 104,
            selected_asset: { status: 'approved', content_revision: 1, provenance: { planner_storage: { sha256: 'b'.repeat(64) } } },
            channel: { type: 'vk' }, publication_fact: null, published_link: null
        },
        workItem: {
            id: 1516, project_id: 10, content_item_id: 1019, kind: 'browser_publish',
            assignee_role: 'browser_publisher', state: 'claimed', lease_token: 'private',
            lease_actor_id: 'user:2', lease_expires_at: new Date('2026-10-06T14:00:00Z')
        },
        attempt: {
            id: 29, project_id: 10, content_item_id: 1019, channel_id: 117,
            mode: 'assisted', status: 'pending', attempt_number: 2,
            requires_manual_confirmation: true, error_message: '[VK_BROWSER_READBACK_UNCONFIRMED]'
        },
        uncertainEvent: {
            after_state: {
                delivery_attempt_id: 29,
                retry_allowed: false,
                reason_code: '[VK_BROWSER_READBACK_UNCONFIRMED]'
            }
        },
        events: [] as any[]
    };
    const tx: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: {
            findFirst: async () => state.task,
            updateMany: async ({ data }: any) => { Object.assign(state.task, data); return { count: 1 }; }
        },
        workItem: {
            findFirst: async () => state.workItem,
            updateMany: async ({ data }: any) => { Object.assign(state.workItem, data); return { count: 1 }; }
        },
        deliveryAttempt: {
            findFirst: async () => state.attempt,
            updateMany: async ({ data }: any) => { Object.assign(state.attempt, data); return { count: 1 }; }
        },
        workflowEvent: {
            findFirst: async ({ where }: any) => where.command === 'ba_apply_vk_browser_pre_submit_recovery'
                ? state.events.find((event: any) => event.idempotency_key === where.idempotency_key) || null
                : state.uncertainEvent,
            create: async ({ data }: any) => {
                const event = { id: state.events.length + 1, ...data };
                state.events.push(event);
                return event;
            }
        }
    };
    return {
        state,
        dependencies: {
            transaction: async (callback: any) => callback(tx),
            hashBody: () => 'a'.repeat(64)
        } as any
    };
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
    expectedFailureCode: '[VK_BROWSER_READBACK_UNCONFIRMED]' as const,
    evidenceSha256: 'c'.repeat(64),
    absenceObservedAt: '2026-10-06T12:10:00.000Z',
    expectedLatestProviderObjectId: '-240051152_29'
};

test('VK pre-submit recovery preview records upload evidence and exact public absence', async () => {
    const h = harness();
    const preview = await previewVkBrowserPreSubmitRecovery(h.dependencies, guards);
    assert.equal(preview.attempt_id, 29);
    assert.equal(preview.provider_upload_observed, true);
    assert.equal(preview.final_submit_observed, false);
    assert.equal(preview.latest_provider_object_id, '-240051152_29');
    assert.equal(preview.publication_fact_created, false);
    assert.match(preview.preview_token, /^sha256:[a-f0-9]{64}$/);
});

test('VK pre-submit recovery apply preserves facts, closes the attempt and rearms idempotently', async () => {
    const h = harness();
    const preview = await previewVkBrowserPreSubmitRecovery(h.dependencies, guards);
    const args = {
        ...guards,
        expectedAttemptId: 29,
        previewToken: preview.preview_token,
        reason: 'Screenshot proves the prepared draft; live public readback proves final submit did not occur.',
        idempotencyKey: 'vk-browser-pre-submit-recovery:10:1019:attempt-29'
    };
    const applied = await applyVkBrowserPreSubmitRecovery(h.dependencies, args);
    assert.equal(applied.replayed, false);
    assert.equal(h.state.attempt.status, 'failed');
    assert.equal(h.state.attempt.error_message, '[VK_BROWSER_PRE_SUBMIT_ABORT_CONFIRMED]');
    assert.equal(h.state.workItem.state, 'available');
    assert.equal(h.state.workItem.lease_token, null);
    assert.equal(h.state.task.status, 'browser_required');
    assert.equal(h.state.task.publication_fact, null);
    assert.equal((await applyVkBrowserPreSubmitRecovery(h.dependencies, args)).replayed, true);
    assert.equal(h.state.events.length, 1);
});

test('VK pre-submit recovery refuses any failure other than exact readback absence', async () => {
    const h = harness();
    h.state.attempt.error_message = '[VK_BROWSER_SUBMIT_UNCERTAIN]';
    await assert.rejects(
        previewVkBrowserPreSubmitRecovery(h.dependencies, guards),
        /VK_BROWSER_PRE_SUBMIT_RECOVERY_ATTEMPT_GUARD_FAILED/
    );
    assert.equal(h.state.workItem.state, 'claimed');
    assert.equal(h.state.events.length, 0);
});
