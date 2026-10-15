const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../dist/db');
const guard = require('../../dist/services/x1113_guard');
const p = require('../../dist/services/x1113_contract').X1113;
function feature() {
    let module;
    try { module = require('../../dist/services/x1113_lifecycle'); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    assert.equal(typeof module?.startX1113, 'function', 'exact X1113 lifecycle must exist');
    return module;
}
const a = { projectId: 10, taskId: 1113, channelId: 164, workItemId: 2000, actorId: 'user:2',
    approvalReference: 'synthetic exact owner approval', idempotencyKey: 'synthetic-x1113-send',
    releaseIdempotencyKey: 'synthetic-x1113-release', expectedManifestChecksum: p.manifest,
    leaseToken: 'synthetic-fence', contentRevision: 1, textSha256: p.bodySha256, selectedAssetId: null, imageSha256: null,
    browserProfile: 'Innokenty', observedAccountRef: '@naraHeTc', observedAt: new Date().toISOString(),
    clientRuntimeGuardSha256: 'a'.repeat(64), contextSource: 'owning_publisher_live_browser_info',
    duplicateCheckReference: 'synthetic native history readback' };
function tx(t, value) {
    const previous = db.default.$transaction;
    db.default.$transaction = async (callback, options) => {
        assert.equal(options.isolationLevel, 'Serializable'); return callback(value);
    };
    t.after(() => { db.default.$transaction = previous; });
}
test('1113 existing attempt is reconciliation only, never a second send', async t => {
    t.mock.method(guard, 'xBoundary', async () => ({ task: { status: 'publishing' } }));
    tx(t, { deliveryAttempt: { findFirst: async () => ({ id: 99, status: 'pending' }) } });
    assert.deepEqual(await feature().startX1113(a), { mode: 'verification_required', attempt_id: 99, retry_allowed: false });
});
test('1113 failed start CAS creates no attempt', async t => {
    let attempts = 0;
    t.mock.method(guard, 'xBoundary', async () => ({ task: { status: 'browser_required', updated_at: new Date() } }));
    tx(t, { deliveryAttempt: { findFirst: async () => null, create: async () => { attempts += 1; } },
        contentItem: { updateMany: async () => ({ count: 0 }) } });
    await assert.rejects(feature().startX1113(a), /CAS_CONFLICT/); assert.equal(attempts, 0);
});
test('1113 repeated pre-submit never permits another click', async t => {
    t.mock.method(guard, 'xBoundary', async () => ({ task: { status: 'publishing' } }));
    tx(t, { deliveryAttempt: { findMany: async () => [{ id: 99, channel_id: 164, status: 'pending', idempotency_key: a.idempotencyKey }] },
        workflowEvent: { findFirst: async ({ where }) => ({ before_state: {
            request_hash: where.command.startsWith('ba_start_') ? guard.xRequestHash(a) : guard.xReadbackHash(a) }, after_state: { attempt_id: 99 } }) } });
    const result = await feature().preSubmitX1113({ ...a, attemptId: 99 });
    assert.equal(result.submission_permitted, false); assert.equal(result.retry_allowed, false);
});
test('1113 uncertain attempt cannot acquire another Submit permission', async t => {
    t.mock.method(guard, 'xBoundary', async () => ({ task: { status: 'publishing' } }));
    tx(t, { deliveryAttempt: { findMany: async () => [{ id: 99, channel_id: 164,
        status: 'verification_required', idempotency_key: a.idempotencyKey }] } });
    await assert.rejects(feature().preSubmitX1113({ ...a, attemptId: 99 }), /RECONCILE_ONLY/);
});
test('1113 confirmation rechecks lease/package inside atomic fact hook before delivered', async t => {
    const fact = require('../../dist/services/publication_fact.service').default;
    t.mock.method(guard, 'xOwner', async () => 2);
    t.mock.method(guard, 'xBoundary', async () => { throw new Error('[X1113_ACTIVE_LEASE_REQUIRED]'); });
    tx(t, { workflowEvent: { findFirst: async () => null } });
    let writes = 0;
    t.mock.method(fact, 'record', async input => { await input.beforeWrite({}); writes += 1; });
    await assert.rejects(feature().confirmX1113({ ...a, attemptId: 99, publicUrl: 'https://x.com/naraHeTc/status/123',
        providerObjectId: '123', publishedAt: '2026-10-15T10:00:00Z', evidenceSha256: 'b'.repeat(64) }), /ACTIVE_LEASE_REQUIRED/);
    assert.equal(writes, 0);
});
test('1113 exact release failed CAS creates no WI or audit', async t => {
    const release = require('../../dist/services/x1113_release');
    let writes = 0;
    t.mock.method(guard, 'xOwner', async () => 2);
    t.mock.method(guard, 'xPackage', async () => ({ draft_text: 'synthetic accepted body', quality_report: {}, updated_at: new Date() }));
    tx(t, { workflowEvent: { findFirst: async () => null, create: async () => { writes += 1; } },
        deliveryAttempt: { findFirst: async () => null }, workItem: { findFirst: async () => null, create: async () => { writes += 1; } },
        contentItem: { updateMany: async () => ({ count: 0 }) } });
    await assert.rejects(release.releaseX1113(a), /CAS_CONFLICT/); assert.equal(writes, 0);
});
test('1113 real package guard validates exact accepted body, current manifest and personal channel', async t => {
    const manifest = require('../../dist/services/agent_workspace_manifest.service');
    t.mock.method(manifest, 'loadAgentWorkspaceManifest', async () => ({ checksum: p.manifest, project: { slug: 'analystcraft-2' } }));
    const task = { channel_id: 164, channel: { type: 'x', name: 'innokenty_x', is_active: true,
        config: { account_ref: p.account, channel_url: p.url, execution_modes: ['manual'] } },
        content_revision: 1, accepted_revision: 1, text_state: 'accepted',
        draft_text: 'A beta is a test harness: define entry criteria and the evidence expected back.\n\nFor Podmasterie’s planned beta, free access will follow an application and a commitment to two short structured reports.\n\nInterviews and testimonials stay optional. What would you require?',
        schedule_at: new Date(p.schedule), publish_at: new Date(p.schedule), selected_asset_id: null,
        visual_state: 'NO_VISUAL_NEEDED', visual_placement: 'feed', visual_decision_version: 1,
        handoff_state: 'ready', quality_report: {}, publication_mode: 'approval_required', status: 'ready_for_execution' };
    const value = { projectMember: { findUnique: async () => ({ role: 'owner' }) },
        contentItem: { findFirst: async () => task }, artDirectionDecision: { findFirst: async ({ where }) => {
            assert.equal(where.id, 308); assert.equal(where.source_content_revision, 1); return { id: 308 }; } },
        workItem: { findFirst: async ({ where }) => { assert.ok([1897, 1901].includes(where.id)); return { id: where.id }; } } };
    assert.equal(await guard.xPackage(value, a, false), task);
    task.channel.config.account_ref = '@foreign';
    await assert.rejects(guard.xPackage(value, a, false), /EXACT_PACKAGE_REQUIRED/);
    task.channel.config.account_ref = p.account; task.draft_text += 'changed';
    await assert.rejects(guard.xPackage(value, a, false), /EXACT_PACKAGE_REQUIRED/);
});
test.after(async () => { await db.default.$disconnect(); await db.pool.end(); });
