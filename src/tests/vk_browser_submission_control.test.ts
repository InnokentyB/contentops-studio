import assert from 'node:assert/strict';
import test from 'node:test';
import {
    confirmVkBrowserSubmission,
    markVkBrowserSubmissionUncertain,
    startVkBrowserSubmission,
    VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED
} from '../services/vk_browser_submission_control.service';

function harness() {
    const state: any = {
        task: {
            id: 900,
            project_id: 10,
            channel_id: 117,
            status: 'browser_required',
            publication_mode: 'browser_required',
            content_revision: 3,
            accepted_revision: 3,
            text_state: 'accepted',
            draft_text: 'Accepted VK publication text',
            selected_asset_id: 18,
            selected_asset: {
                id: 18,
                status: 'approved',
                content_revision: 3,
                provenance: { planner_storage: { sha256: 'b'.repeat(64) } }
            },
            channel: { id: 117, type: 'vk', config: { vk_id: '-240051152' } },
            publication_fact: null,
            published_link: null
        },
        workItem: {
            id: 501,
            project_id: 10,
            content_item_id: 900,
            kind: 'browser_publish',
            assignee_role: 'browser_publisher',
            state: 'claimed',
            lease_token: 'lease-owner-released-vk',
            lease_actor_id: 'user:2',
            lease_expires_at: new Date('2026-10-06T12:00:00.000Z'),
            result_payload: {
                publication_authorized: true,
                approval_reference: 'owner-approved-task-900',
                content_revision: 3,
                body_sha256: 'a'.repeat(64),
                selected_asset_id: 18,
                asset_sha256: 'b'.repeat(64),
                channel_id: 117
            }
        },
        attempt: null as any,
        events: [] as any[],
        factCalls: [] as any[]
    };
    const tx: any = {
        workItem: {
            findFirst: async () => state.workItem,
            updateMany: async () => ({ count: 1 })
        },
        contentItem: {
            findFirst: async () => state.task,
            updateMany: async ({ data }: any) => {
                Object.assign(state.task, data);
                return { count: 1 };
            }
        },
        deliveryAttempt: {
            findFirst: async () => state.attempt,
            create: async ({ data }: any) => {
                state.attempt = { id: 77, ...data };
                return state.attempt;
            },
            updateMany: async ({ data }: any) => {
                Object.assign(state.attempt, data);
                return { count: 1 };
            }
        },
        workflowEvent: {
            findFirst: async () => null,
            create: async ({ data }: any) => {
                state.events.push({ id: state.events.length + 1, ...data });
                return state.events.at(-1);
            }
        }
    };
    const dependencies: any = {
        transaction: async (callback: any) => callback(tx),
        now: () => new Date('2026-10-06T10:00:00.000Z'),
        hashBody: () => 'a'.repeat(64),
        recordFact: async (args: any) => {
            state.factCalls.push(args);
            state.task.publication_fact = { id: 901, ...args };
            state.task.published_link = args.publicUrl;
            return { publication_fact: { id: 901, public_url: args.publicUrl } };
        }
    };
    return { state, dependencies };
}

const startArgs = {
    projectId: 10,
    taskId: 900,
    channelId: 117,
    actorId: 'user:2',
    workItemId: 501,
    leaseToken: 'lease-owner-released-vk',
    approvalReference: 'owner-approved-task-900',
    idempotencyKey: 'vk-browser-submit:10:900:r3',
    contentRevision: 3,
    textSha256: 'a'.repeat(64),
    imageSha256: 'b'.repeat(64),
    selectedAssetId: 18
};

test('VK browser start atomically creates one pending attempt before provider mutation', async () => {
    const h = harness();
    const result = await startVkBrowserSubmission(h.dependencies, startArgs);
    assert.deepEqual(result, { status: 'started', attempt_id: 77, replayed: false });
    assert.equal(h.state.task.status, 'publishing');
    assert.equal(h.state.attempt.status, 'pending');
    assert.equal(h.state.attempt.requires_manual_confirmation, true);

    const replay = await startVkBrowserSubmission(h.dependencies, startArgs);
    assert.deepEqual(replay, {
        status: 'verification_required',
        attempt_id: 77,
        retry_allowed: false,
        replayed: true
    });
    assert.equal(h.state.attempt.attempt_number, 1);
});

test('VK browser confirmation records a fact only for the exact provider identity and lease', async () => {
    const h = harness();
    await startVkBrowserSubmission(h.dependencies, startArgs);
    h.state.task.status = 'browser_required';
    const result = await confirmVkBrowserSubmission(h.dependencies, {
        ...startArgs,
        attemptId: 77,
        publicUrl: 'https://vk.com/wall-240051152_13',
        providerObjectId: '-240051152_13',
        publishedAt: '2026-10-06T10:01:00.000Z',
        evidenceSha256: 'c'.repeat(64)
    });
    assert.equal(result.publication_fact_id, 901);
    assert.equal(h.state.factCalls.length, 1);
    assert.equal(h.state.factCalls[0].publicUrl, 'https://vk.com/wall-240051152_13');
    assert.equal(h.state.attempt.status, 'delivered');
    assert.equal(h.state.attempt.requires_manual_confirmation, false);
});

test('VK browser uncertain result never records a fact and cannot create a second attempt', async () => {
    const h = harness();
    await startVkBrowserSubmission(h.dependencies, startArgs);
    await markVkBrowserSubmissionUncertain(h.dependencies, {
        projectId: 10,
        taskId: 900,
        actorId: 'user:2',
        workItemId: 501,
        leaseToken: 'lease-owner-released-vk',
        attemptId: 77,
        reasonCode: '[VK_BROWSER_READBACK_UNCONFIRMED]',
        idempotencyKey: 'vk-browser-submit:10:900:r3'
    });
    assert.equal(h.state.attempt.status, 'pending');
    assert.equal(h.state.attempt.requires_manual_confirmation, true);
    assert.equal(h.state.factCalls.length, 0);
    await assert.rejects(
        startVkBrowserSubmission(h.dependencies, { ...startArgs, idempotencyKey: 'retry-is-forbidden' }),
        /VK_BROWSER_ATTEMPT_EXISTS/
    );
});

test('VK browser start permits one new attempt only after audited pre-provider recovery', async () => {
    const h = harness();
    h.state.attempt = {
        id: 77,
        project_id: 10,
        content_item_id: 900,
        channel_id: 117,
        mode: 'assisted',
        status: 'failed',
        attempt_number: 1,
        idempotency_key: startArgs.idempotencyKey,
        requires_manual_confirmation: false,
        error_message: VK_BROWSER_PRE_PROVIDER_ABORT_CONFIRMED
    };
    const result = await startVkBrowserSubmission(h.dependencies, {
        ...startArgs,
        idempotencyKey: 'vk-browser-submit:10:900:r3:retry-1'
    });
    assert.equal(result.status, 'started');
    assert.equal(h.state.attempt.attempt_number, 2);
    assert.equal(h.state.attempt.status, 'pending');
});
