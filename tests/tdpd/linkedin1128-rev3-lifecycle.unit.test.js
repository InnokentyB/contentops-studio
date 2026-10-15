const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const guard = require('../../dist/services/linkedin1128_rev3_guard');
const service = require('../../dist/services/linkedin1128_rev3_lifecycle');
const fact = require('../../dist/services/publication_fact.service').default;
const p = require('../../dist/services/linkedin1128_rev3_contract').LINKEDIN1128R3;
const a = { projectId: 7, taskId: 1128, channelId: 6, workItemId: 2001, actorId: 'user:2',
    releaseIdempotencyKey: 'synthetic-rev3-release', leaseToken: 'synthetic', approvalReference: 'synthetic existing owner approval', idempotencyKey: 'synthetic-1128',
    expectedManifestChecksum: p.manifest, contentRevision: 3, textSha256: p.body,
    selectedAssetId: null, imageSha256: null, observedCompanyId: '97416172',
    actionTimeConfirmationReference: 'synthetic owner confirmation at Post',
    observedEditorText: require('../fixtures/linkedin1128-rev3-body'),
    observedPostText: require('../fixtures/linkedin1128-rev3-body'), observedAuthorCompanyId: '97416172', observedPublishedAt: '2026-10-14T10:01:00Z',
    authorEvidenceSha256: 'a'.repeat(64), duplicateCheckReference: 'synthetic duplicate readback' };
function transaction(t, tx) {
    const original = db.default.$transaction;
    db.default.$transaction = async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable'); return callback(tx);
    };
    t.after(() => { db.default.$transaction = original; });
}
test('1128 start never creates another WI and CAS failure creates no attempt', async t => {
    const calls = [];
    t.mock.method(guard, 'check1128Rev3', async () => ({ task: { status: 'browser_required', updated_at: new Date() } }));
    transaction(t, { deliveryAttempt: { findFirst: async () => null, create: async () => calls.push('attempt') },
        contentItem: { updateMany: async () => ({ count: 0 }) } });
    await assert.rejects(service.startLinkedIn1128Rev3(a), /CAS_CONFLICT/);
    assert.deepEqual(calls, []);
});
test('1128 prior attempt is reconcile-only even with a different key', async t => {
    t.mock.method(guard, 'check1128Rev3', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findFirst: async () => ({ id: 123, idempotency_key: 'original' }) } });
    assert.deepEqual(await service.startLinkedIn1128Rev3(a), { mode: 'verification_required', attempt_id: 123, retry_allowed: false });
});
test('1128 atomic confirmation rechecks lease inside canonical fact before mutating attempt', async t => {
    t.mock.method(guard, 'check1128Rev3Owner', async () => undefined);
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(guard, 'check1128Rev3', async () => { throw new Error('[LINKEDIN1128_REV3_LEASE_REQUIRED]'); });
    let writes = 0;
    t.mock.method(fact, 'record', async input => {
        assert.equal(input.confirmationMode, 'manual');
        await input.beforeWrite({ deliveryAttempt: { updateMany: async () => { writes += 1; } } });
        writes += 1;
    });
    await assert.rejects(service.confirmLinkedIn1128Rev3({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) }), /REV3_LEASE_REQUIRED/);
    assert.equal(writes, 0);
});
test('1128 pre-submit rejects changed author evidence under an existing phase key', async t => {
    t.mock.method(guard, 'check1128Rev3', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findMany: async () => [{ id: 123, status: 'pending', channel_id: 6, idempotency_key: a.idempotencyKey }] },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) } } } });
    await assert.rejects(service.preSubmitLinkedIn1128Rev3({ ...a, attemptId: 123, authorEvidenceSha256: 'c'.repeat(64) }), /IDEMPOTENCY_CONFLICT/);
});
test('1128 uncertainty forbids another pre-submit permission', async t => {
    t.mock.method(guard, 'check1128Rev3', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findMany: async () => [{ id: 123, status: 'pending', channel_id: 6,
        idempotency_key: a.idempotencyKey, error_message: 'LINKEDIN1128_REV3_UNCERTAIN_RECONCILE_ONLY' }] },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { submission_permitted: true } } } });
    await assert.rejects(service.preSubmitLinkedIn1128Rev3({ ...a, attemptId: 123 }), /RECONCILE_ONLY/);
});
test('1128 replay of an issued pre-submit check never grants a second Submit', async t => {
    t.mock.method(guard, 'check1128Rev3', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { deliveryAttempt: { findMany: async () => [{ id: 123, status: 'pending', channel_id: 6, idempotency_key: a.idempotencyKey }] },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { submission_permitted: true } } } });
    const result = await service.preSubmitLinkedIn1128Rev3({ ...a, attemptId: 123 });
    assert.equal(result.submission_permitted, false); assert.equal(result.retry_allowed, false);
});
test('1128 valid confirmation updates attempt and audit inside the canonical fact hook', async t => {
    const calls = [];
    t.mock.method(guard, 'check1128Rev3Owner', async () => undefined);
    t.mock.method(guard, 'check1128Rev3', async () => { calls.push('guard'); return { task: { status: 'publishing' } }; });
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(fact, 'record', async input => {
        await input.beforeWrite({ deliveryAttempt: {
            findMany: async () => [{ id: 123, status: 'pending', channel_id: 6, idempotency_key: a.idempotencyKey, created_at: new Date('2026-10-14T10:00:30Z') }],
            updateMany: async ({ data }) => { assert.equal(data.status, 'delivered'); calls.push('attempt'); return { count: 1 }; }
        }, workflowEvent: {
            findFirst: async ({ where }) => where.command.startsWith('ba_start_')
                ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
                : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { attempt_id: 123 }, created_at: new Date('2026-10-14T10:00:45Z') },
            create: async () => calls.push('audit')
        } });
        calls.push('fact'); return {};
    });
    const result = await service.confirmLinkedIn1128Rev3({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) });
    assert.equal(result.mode, 'published'); assert.deepEqual(calls, ['guard', 'attempt', 'audit', 'fact']);
});
test('1128 cannot attach an older publication to a newly started attempt', async t => {
    let writes = 0;
    t.mock.method(guard, 'check1128Rev3Owner', async () => undefined);
    t.mock.method(guard, 'check1128Rev3', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    t.mock.method(fact, 'record', async input => {
        await input.beforeWrite({ deliveryAttempt: {
            findMany: async () => [{ id: 123, status: 'pending', channel_id: 6, idempotency_key: a.idempotencyKey, created_at: new Date('2026-10-15T07:00:00Z') }],
            updateMany: async () => { writes += 1; return { count: 1 }; }
        }, workflowEvent: {
            findFirst: async ({ where }) => where.command.startsWith('ba_start_')
                ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
                : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { attempt_id: 123 }, created_at: new Date('2026-10-15T07:00:30Z') },
            create: async () => undefined
        } });
        return {};
    });
    await assert.rejects(service.confirmLinkedIn1128Rev3({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) }), /PUBLISHED_BEFORE_ATTEMPT/);
    assert.equal(writes, 0);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
test('r3 cannot confirm an unrelated native body or fabricated author/time', async () => {
    for (const patch of [{ observedPostText: 'not this accepted post' }, { observedAuthorCompanyId: 'other' }, { observedPublishedAt: '2026-10-15T10:00:00Z' }]) {
        await assert.rejects(service.confirmLinkedIn1128Rev3({ ...a, attemptId: 123,
            publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
            publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64), ...patch }), /PROVIDER_IDENTITY_INVALID/);
    }
});
test('r3 historical fence allows reconciliation after expiry but never another Submit', async t => {
    const manifest = require('../../dist/services/agent_workspace_manifest.service');
    t.mock.method(manifest, 'loadAgentWorkspaceManifest', async () => ({ checksum: p.manifest, project: { slug: 'seturon' } }));
    const proof = { publication_authorized: true, actor_id: a.actorId, body_sha256: p.body, content_revision: 3,
        channel_id: 6, approval_reference: a.approvalReference, release_idempotency_key: a.releaseIdempotencyKey };
    const binding = { content_revision: 3, body_sha256: p.body, linkedin_company_id: '97416172',
        provider_identity_verified: false, audit_command: p.command };
    const work = { id: 2001, assignee_role: 'browser_publisher', input_context_version: 3, state: 'claimed',
        result_payload: proof, lease_actor_id: a.actorId, lease_token: a.leaseToken, lease_expires_at: new Date('2026-10-15T00:00:00Z') };
    const task = { channel_id: 6, channel: { is_active: true, type: 'linkedin', name: 'seturon_linkedin_page', config: {
        account_ref: 'seturon_linkedin_page', account_type: 'company_page', raw_account: { url: 'https://www.linkedin.com/company/seturon/' }, execution_modes: ['manual'] } },
        content_revision: 3, accepted_revision: 3, text_state: 'accepted', draft_text: a.observedPostText,
        schedule_at: new Date(p.schedule), publish_at: new Date(p.schedule), visual_state: 'NO_VISUAL_NEEDED',
        visual_decision_version: 2, visual_placement: 'feed', selected_asset_id: null, handoff_state: 'ready',
        publication_mode: 'browser_required', status: 'publishing', quality_report: { owner_release: proof, identity_binding: binding } };
    const tx = { projectMember: { findUnique: async () => ({ role: 'owner' }) }, contentItem: { findFirst: async () => task },
        artDirectionDecision: { findFirst: async () => ({ id: 315 }) },
        workItem: { findFirst: async ({ where }) => where.id === 2001 ? work : where.id === 1924 ? { id: 1924 } : { id: 3000 } },
        deliveryAttempt: { findFirst: async () => ({ id: 38 }) }, workflowEvent: { findFirst: async () => ({ after_state: { identity_binding: binding, browser_work_item_id: 2001 } }) } };
    await assert.rejects(guard.check1128Rev3(tx, a), /LEASE_REQUIRED/);
    assert.equal((await guard.check1128Rev3(tx, a, true)).work.id, 2001);
    work.lease_token = 'different-fence';
    await assert.rejects(guard.check1128Rev3(tx, a, true), /LEASE_REQUIRED/);
});
test('r3 normal confirmation and reconciliation use different lease policies', async t => {
    t.mock.method(guard, 'check1128Rev3Owner', async () => undefined);
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    const modes = [];
    t.mock.method(guard, 'check1128Rev3', async (_tx, _a, historical) => { modes.push(historical); throw new Error('synthetic-stop'); });
    t.mock.method(fact, 'record', async input => input.beforeWrite({}));
    const value = { ...a, attemptId: 123, publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
        providerObjectId: 'urn:li:activity:123', publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) };
    await assert.rejects(service.confirmLinkedIn1128Rev3(value, false), /synthetic-stop/);
    await assert.rejects(service.confirmLinkedIn1128Rev3(value, true), /synthetic-stop/);
    assert.deepEqual(modes, [false, true]);
});
test('r3 uncertain state cannot be confirmed through the normal tool even with an active lease', async t => {
    t.mock.method(guard, 'check1128Rev3Owner', async () => undefined);
    t.mock.method(guard, 'check1128Rev3', async () => ({ task: { status: 'publishing' } }));
    transaction(t, { workflowEvent: { findFirst: async () => null } });
    let writes = 0; const commands = [];
    t.mock.method(fact, 'record', async input => input.beforeWrite({
        deliveryAttempt: { findMany: async () => [{ id: 123, channel_id: 6, status: 'verification_required',
            idempotency_key: a.idempotencyKey, created_at: new Date('2026-10-14T10:00:30Z') }],
            updateMany: async () => { writes += 1; return { count: 1 }; } },
        workflowEvent: { findFirst: async ({ where }) => where.command.startsWith('ba_start_')
            ? { before_state: { request_hash: guard.submissionRequestHash(a) } }
            : { before_state: { request_hash: guard.submissionReadbackHash(a) }, after_state: { attempt_id: 123 }, created_at: new Date('2026-10-14T10:00:45Z') },
            create: async ({ data }) => commands.push(data.command) }
    }));
    await assert.rejects(service.confirmLinkedIn1128Rev3({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) }, false), /RECONCILE_ONLY/);
    assert.equal(writes, 0);
    const result = await service.confirmLinkedIn1128Rev3({ ...a, attemptId: 123,
        publicUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123/', providerObjectId: 'urn:li:activity:123',
        publishedAt: '2026-10-14T10:01:00Z', evidenceSha256: 'b'.repeat(64) }, true);
    assert.equal(result.mode, 'published'); assert.equal(writes, 1);
    assert.deepEqual(commands, ['ba_reconcile_linkedin_task1128_rev3_browser_submission']);
});
