import assert from 'node:assert/strict';
import test from 'node:test';
import { DzenTaskPublicationService } from '../services/dzen_task_publication.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const hash = '78081837cecace18c91c01af0253b21ca502e611b63a016f9d9035567587dfd3';
const schedule = new Date('2026-09-22T11:00:00.000Z');

function harness(options: { released?: boolean; verified?: boolean; providerError?: boolean;
    status?: string; delivery?: any } = {}) {
    const task: any = {
        id: 958, project_id: 10, channel_id: 116,
        channel: { type: 'dzen', config: { channel_id: 'dzen-channel', cookies: 'session=test',
            capability_flags: { api_publish: false } } },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted',
        draft_text: 'exact accepted body', visual_placement: 'feed',
        visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null,
        visual_decision_version: 2, handoff_state: 'ready',
        status: options.status || 'ready_for_execution', publication_mode: 'owner_released',
        schedule_at: schedule, published_link: null, publication_fact: null,
        quality_report: options.delivery ? { publication_task_delivery: options.delivery } : {}
    };
    const events: any[] = [];
    let providerCalls = 0;
    let factCalls = 0;
    const db = {
        contentItem: {
            findFirst: async () => task,
            updateMany: async ({ where, data }: any) => {
                if (where.status !== undefined && task.status !== where.status) return { count: 0 };
                if (where.publication_mode !== undefined && task.publication_mode !== where.publication_mode) return { count: 0 };
                Object.assign(task, data);
                return { count: 1 };
            },
            update: async ({ data }: any) => { Object.assign(task, data); return task; }
        },
        workflowEvent: {
            findUnique: async ({ where }: any) => events.find(event => event.data.command === where.project_id_actor_id_command_idempotency_key.command
                && event.data.idempotency_key === where.project_id_actor_id_command_idempotency_key.idempotency_key)
                ? { after_state: events.find(event => event.data.command === where.project_id_actor_id_command_idempotency_key.command
                    && event.data.idempotency_key === where.project_id_actor_id_command_idempotency_key.idempotency_key).data.after_state } : null,
            findFirst: async ({ where }: any) => ['ba_reconcile_dzen_task958_absent', 'ba_resume_dzen_task958_after_absence'].includes(where.command)
                ? null
                : where.command === 'ba_verify_dzen_task958_connector'
                ? options.verified === false ? null : { after_state: {
                    task_id: 958, channel_id: 116, body_sha256: hash,
                    authenticated: true, editor_available: true, checked_at: new Date().toISOString()
                } }
                : options.released === false ? null : { after_state: {
                    task_id: 958, channel_id: 116, content_revision: 1, accepted_revision: 1,
                    body_sha256: hash, visual_decision_id: 147,
                    schedule_at: schedule.toISOString(), publication_mode: 'owner_released'
                } },
            create: async (event: any) => { events.push(event); return event; }
        },
        artDirectionDecision: { findFirst: async ({ where }: any) => {
            assert.equal(where.channel, 'analystcraft_dzen');
            return { id: 147, decision_version: 2 };
        } },
        projectMember: { findFirst: async () => ({ user_id: 2 }), findUnique: async () => ({ role: 'owner' }) },
        project: { findUnique: async () => ({ slug: 'analystcraft-2' }) },
        $transaction: async (fn: any) => fn(db)
    };
    const service = new DzenTaskPublicationService({
        db, hashBody: () => hash,
        dzen: { publishPost: async () => {
            providerCalls += 1;
            if (options.providerError) throw new Error('unknown provider result');
            return 'https://dzen.ru/b/approved-task958';
        }, testConnection: async () => ({ authenticated: true, editor_available: true,
            editor_url: 'https://dzen.ru/profile/editor/id/dzen-channel' }) },
        facts: { record: async () => { factCalls += 1; return {}; } }
    });
    return { service, task, events, get providerCalls() { return providerCalls; }, get factCalls() { return factCalls; } };
}

test('Dzen release tool is publisher-only and delivery rejects missing owner proof', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_release_approved_dzen_task958'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_reconcile_dzen_task958_absent'), true);
    assert.equal(isToolAllowedForProfile('publisher', 'ba_resume_dzen_task958_after_absence'), true);
    assert.equal(isToolAllowedForProfile('planner', 'ba_release_approved_dzen_task958'), false);
    assert.equal(isToolAllowedForProfile('planner', 'ba_reconcile_dzen_task958_absent'), false);
    assert.equal(isToolAllowedForProfile('planner', 'ba_resume_dzen_task958_after_absence'), false);
    const h = harness({ released: false });
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, dryRun: true }), /OWNER_RELEASE_PROOF_MISMATCH/);
    assert.equal(h.providerCalls, 0);
});

test('Dzen unverified connector blocks dry-run and live without provider call', async () => {
    const h = harness({ verified: false });
    const dry = await h.service.execute({ projectId: 10, taskId: 958, dryRun: true });
    assert.equal(dry.route_executable, false);
    assert.equal(dry.route_blocker, 'DZEN_CONNECTOR_NOT_READY');
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' }), /DZEN_CONNECTOR_NOT_READY/);
    assert.equal(h.providerCalls, 0);
    assert.equal(h.task.status, 'ready_for_execution');
});

test('Dzen connector probe requires owner and records task-scoped session proof', async () => {
    assert.equal(isToolAllowedForProfile('publisher', 'ba_verify_dzen_task958_connector'), true);
    const h = harness({ verified: false });
    const proof = await h.service.verifyConnector({ projectId: 10, taskId: 958,
        actorId: 'user:2', idempotencyKey: 'verify958' });
    assert.equal(proof.authenticated, true);
    assert.equal(proof.body_sha256, hash);
    assert.equal(h.events.length, 1);
    await assert.rejects(h.service.verifyConnector({ projectId: 10, taskId: 959,
        actorId: 'user:2', idempotencyKey: 'bad' }), /SCOPE_MISMATCH/);
});

test('Dzen exact released task sends once and replays confirmed result', async () => {
    const h = harness();
    const dry = await h.service.execute({ projectId: 10, taskId: 958, dryRun: true });
    assert.equal(dry.route_executable, true);
    const sent = await h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' });
    assert.equal(sent.published_link, 'https://dzen.ru/b/approved-task958');
    assert.equal(h.providerCalls, 1);
    assert.equal(h.factCalls, 1);
    assert.equal(h.task.status, 'published');
    const replay = await h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' });
    assert.equal(replay.replayed, true);
    assert.equal(h.providerCalls, 1);
});

test('uncertain Dzen result freezes task and never retries provider', async () => {
    const h = harness({ providerError: true });
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' }), /DZEN_PUBLICATION_UNCERTAIN/);
    assert.equal(h.task.status, 'publishing');
    assert.equal(h.task.quality_report.publication_task_delivery.retry_via_api, false);
    await assert.rejects(h.service.execute({ projectId: 10, taskId: 958, idempotencyKey: 'send958' }), /DZEN_PUBLICATION_STATE_CHANGED/);
    assert.equal(h.providerCalls, 1);
    assert.equal(h.factCalls, 0);
});

test('owner reconciliation moves exact uncertain task to blocked without provider call', async () => {
    const h = harness({ status: 'publishing', delivery: {
        state: 'provider_result_uncertain', idempotency_key: 'publish-task-958-rev1-20260923'
    } });
    const result = await h.service.reconcileAbsent({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash,
        previousIdempotencyKey: 'publish-task-958-rev1-20260923',
        reason: 'provider_absence_confirmed_pre_send', idempotencyKey: 'reconcile958' });
    assert.equal(result.status, 'blocked');
    assert.equal(h.task.status, 'blocked');
    assert.equal(h.task.quality_report.publication_task_delivery.state, 'reconciled_absent');
    assert.equal(h.providerCalls, 0);
    assert.equal(h.factCalls, 0);
});

test('owner resume authorizes one new explicit idempotency without publishing', async () => {
    const h = harness({ status: 'blocked', delivery: {
        state: 'reconciled_absent', idempotency_key: 'publish-task-958-rev1-20260923',
        reason: 'provider_absence_confirmed_pre_send'
    } });
    const result = await h.service.resumeAfterAbsence({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash,
        previousIdempotencyKey: 'publish-task-958-rev1-20260923',
        nextPublicationIdempotencyKey: 'publish-task-958-rev1-resume-20260923-001',
        approvalReference: 'owner-approved-resume-after-confirmed-absence', idempotencyKey: 'resume958' });
    assert.equal(result.status, 'ready_for_execution');
    assert.equal(result.explicit_send_required, true);
    assert.equal(h.task.status, 'ready_for_execution');
    assert.equal(h.providerCalls, 0);
    assert.equal(h.factCalls, 0);
});

test('second confirmed absence authorizes only the exact resume2 publication key', async () => {
    const secondAttempt = 'publish-task-958-rev1-resume-20260923-001';
    const h = harness({ status: 'publishing', delivery: {
        state: 'provider_result_uncertain', idempotency_key: secondAttempt
    } });
    await h.service.reconcileAbsent({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: secondAttempt,
        reason: 'provider_absence_confirmed_pre_send', idempotencyKey: 'reconcile958-second' });
    const result = await h.service.resumeAfterAbsence({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: secondAttempt,
        nextPublicationIdempotencyKey: 'publish-task-958-rev1-resume2-20260923-001',
        approvalReference: 'owner-approved-second-resume-after-confirmed-absence',
        idempotencyKey: 'resume958-second' });
    assert.equal(result.next_publication_idempotency_key, 'publish-task-958-rev1-resume2-20260923-001');
    assert.equal(h.providerCalls, 0);
    await assert.rejects(h.service.resumeAfterAbsence({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: secondAttempt,
        nextPublicationIdempotencyKey: 'some-other-key', approvalReference: 'owner-approved-but-wrong-key',
        idempotencyKey: 'resume958-wrong' }), /RESUME_SCOPE_MISMATCH/);
});

test('third confirmed absence authorizes only the exact resume3 publication key', async () => {
    const thirdAttempt = 'publish-task-958-rev1-resume2-20260923-001';
    const h = harness({ status: 'publishing', delivery: {
        state: 'provider_result_uncertain', idempotency_key: thirdAttempt
    } });
    await h.service.reconcileAbsent({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: thirdAttempt,
        reason: 'provider_absence_confirmed_pre_send', idempotencyKey: 'reconcile958-third' });
    const result = await h.service.resumeAfterAbsence({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: thirdAttempt,
        nextPublicationIdempotencyKey: 'publish-task-958-rev1-resume3-20260923-001',
        approvalReference: 'owner-approved-third-resume-after-confirmed-absence',
        idempotencyKey: 'resume958-third' });
    assert.equal(result.next_publication_idempotency_key, 'publish-task-958-rev1-resume3-20260923-001');
    assert.equal(h.providerCalls, 0);
    assert.equal(h.factCalls, 0);
});

test('fourth confirmed absence authorizes only the exact resume4 publication key', async () => {
    const fourthAttempt = 'publish-task-958-rev1-resume3-20260923-001';
    const h = harness({ status: 'publishing', delivery: {
        state: 'provider_result_uncertain', idempotency_key: fourthAttempt
    } });
    await h.service.reconcileAbsent({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: fourthAttempt,
        reason: 'provider_absence_confirmed_pre_send', idempotencyKey: 'reconcile958-fourth' });
    const result = await h.service.resumeAfterAbsence({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: fourthAttempt,
        nextPublicationIdempotencyKey: 'publish-task-958-rev1-resume4-20260923-001',
        approvalReference: 'owner-approved-fourth-resume-after-confirmed-absence',
        idempotencyKey: 'resume958-fourth' });
    assert.equal(result.next_publication_idempotency_key, 'publish-task-958-rev1-resume4-20260923-001');
    assert.equal(h.providerCalls, 0);
    assert.equal(h.factCalls, 0);
});

test('fifth confirmed absence authorizes only the exact resume5 publication key', async () => {
    const fifthAttempt = 'publish-task-958-rev1-resume4-20260923-001';
    const h = harness({ status: 'publishing', delivery: {
        state: 'provider_result_uncertain', idempotency_key: fifthAttempt
    } });
    await h.service.reconcileAbsent({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: fifthAttempt,
        reason: 'provider_absence_confirmed_pre_send', idempotencyKey: 'reconcile958-fifth' });
    const result = await h.service.resumeAfterAbsence({ projectId: 10, taskId: 958, channelId: 116,
        actorId: 'user:2', expectedBodySha256: hash, previousIdempotencyKey: fifthAttempt,
        nextPublicationIdempotencyKey: 'publish-task-958-rev1-resume5-20260923-001',
        approvalReference: 'owner-approved-fifth-resume-after-confirmed-absence',
        idempotencyKey: 'resume958-fifth' });
    assert.equal(result.next_publication_idempotency_key, 'publish-task-958-rev1-resume5-20260923-001');
    assert.equal(h.providerCalls, 0);
    assert.equal(h.factCalls, 0);
});
