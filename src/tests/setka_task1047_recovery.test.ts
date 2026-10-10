import test from 'node:test';
import assert from 'node:assert/strict';
import {
    confirmSetkaTask1047,
    markSetkaTask1047Uncertain,
    releaseSetkaTask1047,
    SETKA1047,
    startSetkaTask1047
} from '../services/setka_task1047_recovery.service';
import { isToolAllowedForProfile } from '../mcp/capabilities';

const releaseArgs = { projectId: 10, taskId: 1047, actorId: 'user:2', expectedChannelId: 126,
    expectedContentRevision: 4, expectedAcceptedRevision: 4, expectedBodySha256: SETKA1047.bodySha256,
    expectedDecisionId: 269, expectedSelectedAssetId: 131, expectedAssetSha256: SETKA1047.assetSha256,
    expectedScheduleAt: SETKA1047.schedule, expectedManifestChecksum: SETKA1047.manifest,
    expectedRegistryProfileId: 'profile_126', expectedProfileUrl: SETKA1047.profileUrl,
    approvalReference: 'owner confirmed no visible post and recovery', idempotencyKey: 'setka1047-release-v1' } as const;

function fixture() {
    const channel: any = { id: 126, project_id: 10, name: 'analystcraft_setka', type: 'setka', is_active: true,
        updated_at: new Date('2026-10-10T10:00:00Z'), config: { account_ref: 'analystcraft_setka',
            execution_modes: ['manual'], workflow_mode: 'standard', capability_flags: { api_publish: false,
                manual_handoff: false, browser_publish: false } } };
    const task: any = { id: 1047, project_id: 10, channel_id: 126, channel, type: 'publication',
        status: 'ready_for_execution', publication_mode: 'approval_required', handoff_state: 'ready',
        content_revision: 4, accepted_revision: 4, text_state: 'accepted', draft_text: 'accepted',
        visual_state: 'APPROVED', visual_placement: 'feed', visual_decision_version: 2,
        selected_asset_id: 131, selected_asset: { id: 131, decision_id: 269, content_revision: 4,
            placement: 'feed', status: 'approved', provenance: { planner_storage: { managed: true,
                provider: 'r2', mime_type: 'image/png', sha256: SETKA1047.assetSha256 } } },
        schedule_at: new Date(SETKA1047.schedule), publish_at: new Date(SETKA1047.schedule),
        publication_fact: null, published_link: null, quality_report: {}, week_package_id: 1, item_key: 'task1047' };
    let work: any = null;
    let attempt: any = null;
    const events: any[] = [];
    let factCalls = 0;
    const tx: any = {
        projectMember: { findUnique: async () => ({ role: 'owner' }) },
        workflowEvent: { findFirst: async ({ where }: any) => events.find(e => e.command === where.command
            && e.idempotency_key === where.idempotency_key) || null,
        create: async ({ data }: any) => { events.push(data); return data; } },
        contentItem: { findFirst: async () => task, updateMany: async ({ where, data }: any) => {
            if (where.status && where.status !== task.status) return { count: 0 };
            Object.assign(task, data); return { count: 1 };
        } },
        artDirectionDecision: { findUnique: async () => ({ id: 269, decision_version: 2,
            source_content_revision: 4, placement: 'feed', decision: 'GENERATE', status: 'active' }) },
        deliveryAttempt: { findFirst: async ({ where }: any) => attempt && (!where.id || where.id === attempt.id) ? attempt : null,
            create: async ({ data }: any) => { attempt = { id: 700, ...data }; return attempt; },
            updateMany: async ({ where, data }: any) => {
                if (!attempt || attempt.id !== where.id || attempt.status !== where.status) return { count: 0 };
                Object.assign(attempt, data); return { count: 1 };
            } },
        workItem: { findFirst: async () => work, findUnique: async () => work,
            create: async ({ data }: any) => { work = { id: 2000, ...data }; return work; } },
        socialChannel: { updateMany: async ({ data }: any) => { channel.config = data.config;
            channel.updated_at = new Date('2026-10-10T16:00:00Z'); return { count: 1 }; } }
    };
    const dependencies: any = { transaction: async (run: any) => run(tx),
        manifest: async () => ({ checksum: SETKA1047.manifest }), now: () => new Date('2026-10-10T16:00:00Z'),
        hashBody: () => SETKA1047.bodySha256,
        recordFact: async (args: any) => { factCalls += 1; task.publication_fact = { id: 800, outcome: 'published',
            public_url: args.publicUrl }; return { publication_fact: task.publication_fact }; } };
    const claim = () => { work.state = 'claimed'; work.lease_actor_id = 'publisher:2'; work.lease_token = 'lease';
        work.lease_expires_at = new Date('2026-10-10T17:00:00Z'); };
    const boundary = { projectId: 10, taskId: 1047, channelId: 126, actorId: 'publisher:2',
        workItemId: 2000, leaseToken: 'lease', approvalReference: releaseArgs.approvalReference,
        idempotencyKey: 'setka1047-attempt-v1', contentRevision: 4,
        textSha256: SETKA1047.bodySha256, selectedAssetId: 131, imageSha256: SETKA1047.assetSha256 } as const;
    return { task, channel, dependencies, claim, boundary, getWork: () => work,
        getAttempt: () => attempt, factCalls: () => factCalls };
}

test('Setka1047 release atomically binds durable identity and creates one manual browser handoff', async () => {
    const f = fixture();
    const immutable = { revision: f.task.content_revision, body: f.task.draft_text,
        asset: f.task.selected_asset_id, schedule: f.task.schedule_at.toISOString() };
    const result: any = await releaseSetkaTask1047(releaseArgs, f.dependencies);
    assert.equal(result.profile_url, SETKA1047.profileUrl);
    assert.equal(f.channel.config.profile_url, SETKA1047.profileUrl);
    assert.equal(f.channel.config.capability_flags.api_publish, false);
    assert.equal(f.channel.config.capability_flags.manual_handoff, true);
    assert.equal(f.channel.config.capability_flags.browser_publish, true);
    assert.equal(f.task.status, 'browser_required');
    assert.equal(f.getWork().state, 'available');
    assert.deepEqual({ revision: f.task.content_revision, body: f.task.draft_text,
        asset: f.task.selected_asset_id, schedule: f.task.schedule_at.toISOString() }, immutable);
    assert.equal(f.task.publication_fact, null);
});

test('Setka1047 lifecycle is owner/Publisher-scoped and not exposed to planning or writing roles', () => {
    const tools = ['ba_release_setka_task1047_browser', 'ba_claim_setka_task1047_browser_publication',
        'ba_start_setka_task1047_browser_submission', 'ba_confirm_setka_task1047_browser_submission',
        'ba_mark_setka_task1047_browser_submission_uncertain'];
    for (const tool of tools) {
        assert.equal(isToolAllowedForProfile('owner', tool), true);
        assert.equal(isToolAllowedForProfile('publisher', tool), true);
        for (const profile of ['planner', 'writer', 'editor', 'art_director', 'growth_analyst', 'strategist'] as const) {
            assert.equal(isToolAllowedForProfile(profile, tool), false, `${profile}:${tool}`);
        }
    }
});

test('Setka1047 uncertain submission freezes retry and records no publication fact', async () => {
    const f = fixture();
    await releaseSetkaTask1047(releaseArgs, f.dependencies); f.claim();
    const started = await startSetkaTask1047(f.boundary, f.dependencies);
    const uncertain = await markSetkaTask1047Uncertain({ projectId: 10, taskId: 1047,
        actorId: 'publisher:2', workItemId: 2000, leaseToken: 'lease', attemptId: started.attempt_id,
        reasonCode: 'SETKA_READBACK_UNCONFIRMED', idempotencyKey: f.boundary.idempotencyKey }, f.dependencies);
    assert.equal(uncertain.retry_allowed, false);
    assert.equal(f.getAttempt().requires_manual_confirmation, true);
    assert.equal(f.factCalls(), 0);
    await assert.rejects(startSetkaTask1047({ ...f.boundary, idempotencyKey: 'retry' }, f.dependencies), /ATTEMPT_EXISTS/);
});

test('Setka1047 start preserves persisted owner authorization when the execution confirmation text changes', async () => {
    const f = fixture();
    await releaseSetkaTask1047(releaseArgs, f.dependencies); f.claim();
    const started = await startSetkaTask1047({ ...f.boundary,
        approvalReference: 'owner confirmed final Setka submit in headquarters' }, f.dependencies);
    assert.equal(started.status, 'started');
    assert.equal(started.replayed, false);
});

test('Setka1047 start rejects a work item whose owner proof drifted from the task release', async () => {
    const f = fixture();
    await releaseSetkaTask1047(releaseArgs, f.dependencies); f.claim();
    f.getWork().result_payload = structuredClone(f.getWork().result_payload);
    f.getWork().result_payload.approval_reference = 'different persisted approval';
    await assert.rejects(startSetkaTask1047(f.boundary, f.dependencies), /SUBMISSION_GUARD_FAILED/);
});

test('Setka1047 confirmation accepts only exact Setka permalink and writes one fact', async () => {
    const f = fixture();
    await releaseSetkaTask1047(releaseArgs, f.dependencies); f.claim();
    const started = await startSetkaTask1047(f.boundary, f.dependencies);
    const postId = '01a12345-abcd-7def-8123-0123456789ab';
    await assert.rejects(confirmSetkaTask1047({ ...f.boundary, attemptId: started.attempt_id,
        publicUrl: `https://example.com/posts/${postId}`, providerObjectId: postId,
        publishedAt: '2026-10-10T16:15:00Z', evidenceSha256: 'a'.repeat(64) }, f.dependencies), /PROVIDER_IDENTITY_INVALID/);
    const result = await confirmSetkaTask1047({ ...f.boundary, attemptId: started.attempt_id,
        publicUrl: `https://setka.ru/posts/${postId}`, providerObjectId: postId,
        publishedAt: '2026-10-10T16:15:00Z', evidenceSha256: 'a'.repeat(64) }, f.dependencies);
    assert.equal(result.public_url, `https://setka.ru/posts/${postId}`);
    assert.equal(f.factCalls(), 1);
    assert.equal(f.getAttempt().status, 'delivered');
});
