const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID, generateKeyPairSync, sign } = require('node:crypto');
const path = require('node:path');
const { body, sha, snapshot: template } = require('./shared-browser.fixture.cjs');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, 'synthetic-db');
assert.equal(url.pathname, '/shared_browser_synthetic'); assert.equal(url.username, 'synthetic');
const base = process.env.SHARED_BROWSER_DIST || '/opt/planner/dist';
const { prisma: db, pool } = require(path.join(base, 'db.js'));
const { loadAgentWorkspaceManifest: manifest } = require(path.join(base, 'services/agent_workspace_manifest.service.js'));
const release = require(path.join(base, 'services/browser_publication_release.js'));
const lifecycle = require(path.join(base, 'services/browser_publication_execution.js'));
const pairing = require(path.join(base, 'services/x_native_pairing.js'));
const registry = require(path.join(base, 'services/x_native_registry.js'));
const control = require(path.join(base, 'services/x_native_control.js'));
const advance = require(path.join(base, 'services/x_native_advance.js'));
const execution = require(path.join(base, 'services/x_native_execution.js'));
const wire = require(path.join(base, 'services/x_native_receipt.js'));
const deps = { db, manifest }, extensionId = 'a'.repeat(32), bundleSha256 = '8'.repeat(64), origin = `chrome-extension://${extensionId}`;
test.after(async () => { await db.$disconnect(); await pool.end(); });
const fulfilled = results => results.filter(r => r.status === 'fulfilled');
async function setup(t) {
    const nonce = randomUUID(), handle = 'synthetic_test';
    const user = await db.user.create({ data: { email: `x-native-${nonce}@example.invalid`, name: 'Synthetic native', password_hash: 'not-a-login' } });
    const project = await db.project.create({ data: { name: 'Synthetic X native lifecycle', slug: `x-native-synthetic-${nonce}` } });
    t.after(async () => {
        const current = await db.project.findUnique({ where: { id: project.id } });
        assert.equal(current?.slug, `x-native-synthetic-${nonce}`);
        await db.project.delete({ where: { id: project.id } }); await db.user.delete({ where: { id: user.id } });
    });
    await db.projectMember.create({ data: { project_id: project.id, user_id: user.id, role: 'owner' } });
    const channel = await db.socialChannel.create({ data: { project_id: project.id, name: 'synthetic_x', type: 'x', is_active: true,
        config: { account_ref: `@${handle}`, account_type: 'personal', channel_url: `https://x.com/${handle}`,
            execution_modes: ['manual'], capability_flags: { manual_handoff: true } } } });
    const task = await db.contentItem.create({ data: { project_id: project.id, channel_id: channel.id, type: 'publication',
        item_key: `x-native-${nonce}`, content_revision: 5, accepted_revision: 5, draft_text: body, text_state: 'accepted',
        status: 'ready_for_execution', publication_mode: 'approval_required', handoff_state: 'ready', visual_state: 'NO_VISUAL_NEEDED',
        visual_mode: 'none', visual_placement: 'feed', visual_decision_version: 4, schedule_at: new Date(template.scheduleAt),
        publish_at: new Date(template.publishAt), quality_report: { content_language: 'en',
            handoff_bundle: { content_language: 'en', publication: { body }, task: { account_ref: `@${handle}` } } } } });
    const actorId = `user:${user.id}`;
    const decision = await db.artDirectionDecision.create({ data: { project_id: project.id, content_item_id: task.id,
        decision_version: 4, source_content_revision: 5, channel: 'x', placement: 'feed', decision: 'NO_VISUAL_NEEDED',
        status: 'active', actor_id: actorId, reason: 'Synthetic accepted no-visual decision' } });
    const current = await manifest(project.id, user.id);
    const snapshot = { ...template, projectId: project.id, taskId: task.id, channelId: channel.id,
        selectedAssetId: null, assetSha256: null, decisionId: decision.id, bodySha256: sha(body), manifestChecksum: current.checksum,
        identity: { ...template.identity, platform: 'x', accountType: 'personal', accountRef: `@${handle}`,
            providerAccountId: handle, profileUrl: `https://x.com/${handle}` } };
    const args = { projectId: project.id, taskId: task.id, actorId, snapshot,
        approvalReference: 'Synthetic exact owner approval', idempotencyKey: 'release', apply: true };
    await release.repairBrowserPublicationMetadata({ ...args, idempotencyKey: 'metadata' }, deps);
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), raw = keys.publicKey.export({ format: 'jwk' });
    const publicKey = wire.nativePublicKeySchema.parse({ kty: raw.kty, crv: raw.crv, x: raw.x, y: raw.y });
    const installationId = wire.nativeKeyFingerprint(publicKey);
    const signature = value => sign('sha256', Buffer.from(value), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const pair = await pairing.issueNativePairing({ ...args, publicKey, installationId, bundleSha256, extensionId }, deps);
    const unsigned = { challenge: pair.challenge, account: snapshot.identity.accountRef, bodySha256: snapshot.bodySha256, observedAt: new Date().toISOString() };
    await pairing.verifyNativePairing({ ...unsigned, signature: signature(pairing.nativePairingMessage(unsigned)) }, deps, origin);
    const enrollment = { ...args, publicKey, installationId, bundleSha256, extensionId, pairingNonce: pair.challenge.nonce,
        uatReference: 'Explicit synthetic owner no-send UAT' };
    const read = (challenge, operation) => {
        const value = { projectId: args.projectId, channelId: snapshot.channelId, installationId, bundleSha256,
            operation, nonce: challenge.nonce, observedAt: new Date().toISOString() };
        return { ...value, signature: signature(wire.nativeReadMessage(value)) };
    };
    const receipt = (challenge, unknown = false) => {
        const value = { challenge, observation: unknown ? { kind: 'unknown', reason: 'native_gap', observedAt: new Date().toISOString() }
            : { kind: 'editor', observedAt: new Date().toISOString(), account: snapshot.identity.accountRef, text: body,
                editorMode: 'new_post', attachments: 0, historyFrom: snapshot.scheduleAt, historyThrough: new Date().toISOString(),
                historyComplete: true, scannedStatuses: 1, duplicateFound: false } };
        return { receipt: { ...value, signature: signature(wire.nativeMessage(value)) } };
    };
    return { args, enrollment, installationId, read, receipt, signMessage: signature };
}
async function ready(t) {
    const state = await setup(t);
    await registry.registerNativeInstallation(state.enrollment, deps);
    const released = await release.releaseBrowserPublication(state.args, deps), workItemId = released.browser_work_item_id;
    const lease = await lifecycle.claimBrowserPublication({ ...state.args, workItemId, idempotencyKey: 'claim' }, deps);
    const context = { ...state.args, apply: false, workItemId, leaseToken: lease.lease_token, idempotencyKey: 'send' };
    const issued = await control.issueNativeChallenge({ context, installationId: state.installationId, bundleSha256, phase: 'start', attemptId: null }, deps);
    return { ...state, context, challenge: issued.challenge };
}
async function renewalSetup(t) {
    const s = await setup(t), actualNow = Date.now, now = actualNow() + 300001;
    Date.now = () => now; t.after(() => { Date.now = actualNow; });
    const { pairingNonce, uatReference, ...args } = s.enrollment;
    const renew = () => pairing.issueNativePairing({ ...args, idempotencyKey: 'renew-current-installation' }, deps);
    return { ...s, renew };
}
test('PostgreSQL concurrent reissue creates one active successor and preserves historical proof', async t => {
    const s = await renewalSetup(t);
    const before = await db.projectSettings.findFirst({ where: { project_id: s.args.projectId, key: { startsWith: 'x_native:pairing:v1:' } } });
    const results = await Promise.allSettled([s.renew(), s.renew()]);
    assert.ok(fulfilled(results).length >= 1);
    assert.equal(new Set(fulfilled(results).map(r=>r.value.challenge.nonce)).size, 1);
    assert.equal(await db.workflowEvent.count({ where: { project_id: s.args.projectId, command: 'x_native_pairing_superseded' } }), 1);
    assert.equal(await db.projectSettings.count({ where: { project_id: s.args.projectId, key: { startsWith: 'x_native:pairing:v1:' } } }), 2);
    assert.equal((await db.projectSettings.findUnique({ where: { id: before.id } })).value, before.value);
    assert.equal(await db.deliveryAttempt.count({ where: { content_item_id: s.args.taskId } }), 0);
});
test('PostgreSQL enrollment versus reissue has one winner without reviving the old nonce', async t => {
    const s = await renewalSetup(t);
    const results = await Promise.allSettled([s.renew(), registry.registerNativeInstallation(s.enrollment, deps)]);
    assert.equal(fulfilled(results).length, 1);
    const renewed = await db.workflowEvent.count({ where: { project_id: s.args.projectId, command: 'x_native_pairing_superseded' } });
    const registered = await db.workflowEvent.count({ where: { project_id: s.args.projectId, command: 'x_native_register_installation' } });
    assert.equal(renewed + registered, 1);
    assert.equal(await db.deliveryAttempt.count({ where: { content_item_id: s.args.taskId } }), 0);
});
test('PostgreSQL concurrent enrollment consumes one signed pairing and creates one audited installation', async t => {
    const s = await setup(t);
    const results = await Promise.allSettled([registry.registerNativeInstallation(s.enrollment, deps), registry.registerNativeInstallation(s.enrollment, deps)]);
    assert.ok(fulfilled(results).length >= 1);
    assert.equal(await db.workflowEvent.count({ where: { project_id: s.args.projectId, command: 'x_native_register_installation' } }), 1);
    assert.equal(await db.projectSettings.count({ where: { project_id: s.args.projectId, key: { startsWith: 'x_native:installation:' } } }), 1);
    const row = await db.projectSettings.findFirst({ where: { project_id: s.args.projectId, key: { startsWith: 'x_native:pairing:' } } });
    assert.equal(JSON.parse(row.value).consumed, true);
    assert.equal(await db.deliveryAttempt.count({ where: { content_item_id: s.args.taskId } }), 0);
});
test('PostgreSQL signed start and permit races create one attempt and at most one true permit', async t => {
    const s = await ready(t), proof = s.receipt(s.challenge);
    const starts = await Promise.allSettled([execution.executeNativeReceipt(proof, deps, origin), execution.executeNativeReceipt(proof, deps, origin)]);
    assert.ok(fulfilled(starts).length >= 1);
    assert.equal(await db.deliveryAttempt.count({ where: { content_item_id: s.args.taskId } }), 1);
    assert.equal(await db.workflowEvent.count({ where: { content_item_id: s.args.taskId, command: 'x_native_consume_receipt' } }), 1);
    const stage = await advance.advanceNativeChallenge(s.read(s.challenge, 'advance'), false, deps, origin);
    assert.ok(!JSON.stringify(stage).includes(s.context.leaseToken));
    const permitProof = s.receipt(stage.challenge);
    const permits = await Promise.allSettled([execution.executeNativeReceipt(permitProof, deps, origin), execution.executeNativeReceipt(permitProof, deps, origin)]);
    assert.equal(fulfilled(permits).filter(r => r.value.submission_permitted === true).length, 1);
    assert.equal(await db.workflowEvent.count({ where: { content_item_id: s.args.taskId, command: 'x_native_consume_receipt' } }), 2);
    const task = await db.contentItem.findUnique({ where: { id: s.args.taskId } });
    assert.equal(task.draft_text, body); assert.equal(task.accepted_revision, 5); assert.equal(task.selected_asset_id, null);
    assert.equal(await db.publicationFact.count({ where: { content_item_id: s.args.taskId } }), 0);
});
test('PostgreSQL later attempt-audit failure rolls back nonce consumption and attempt together', async t => {
    const s = await ready(t);
    const failDb = new Proxy(db, { get(target, field) {
        if (field !== '$transaction') return Reflect.get(target, field);
        return (run, options) => db.$transaction(tx => run(new Proxy(tx, { get(client, key) {
            if (key !== 'workflowEvent') return Reflect.get(client, key);
            return new Proxy(client.workflowEvent, { get(delegate, operation) {
                if (operation !== 'create') return Reflect.get(delegate, operation);
                return input => { if (input.data.command === 'ba_start_browser_submission') throw Error('synthetic late attempt-audit failure');
                    return delegate.create(input); };
            } });
        } })), options);
    } });
    await assert.rejects(execution.executeNativeReceipt(s.receipt(s.challenge), { ...deps, db: failDb }, origin), /late attempt-audit failure/);
    assert.equal(await db.deliveryAttempt.count({ where: { content_item_id: s.args.taskId } }), 0);
    assert.equal(await db.workflowEvent.count({ where: { content_item_id: s.args.taskId, command: 'x_native_consume_receipt' } }), 0);
    const row = await db.projectSettings.findFirst({ where: { project_id: s.args.projectId, key: { startsWith: 'x_native:challenge:' } } });
    assert.equal(JSON.parse(row.value).consumedSha256, null);
    assert.equal((await db.contentItem.findUnique({ where: { id: s.args.taskId } })).status, 'browser_required');
});
test('PostgreSQL build mismatch and legacy enrollment cannot consume a nonce or create an attempt', async t => {
    const s = await ready(t);
    const wrong = { ...s.read(s.challenge, 'read'), bundleSha256: '9'.repeat(64) };
    wrong.signature = s.signMessage(wire.nativeReadMessage(wrong));
    await assert.rejects(control.readNativeChallenge(wrong, deps, origin), /BUNDLE_MISMATCH/);
    await assert.rejects(execution.executeNativeReceipt(s.receipt({ ...s.challenge, bundleSha256: '9'.repeat(64) }), deps, origin), /BUNDLE_MISMATCH/);
    await assert.rejects(control.issueNativeChallenge({ context: s.context, installationId: s.installationId,
        bundleSha256: '9'.repeat(64), phase: 'start', attemptId: null }, deps), /BUNDLE_MISMATCH/);
    const installed = await db.projectSettings.findFirst({ where: { project_id: s.args.projectId, key: { startsWith: 'x_native:installation:' } } });
    const legacy = JSON.parse(installed.value); delete legacy.bundleSha256;
    await db.projectSettings.update({ where: { id: installed.id }, data: { value: JSON.stringify(legacy) } });
    await assert.rejects(execution.executeNativeReceipt(s.receipt(s.challenge), deps, origin));
    assert.equal(await db.deliveryAttempt.count({ where: { content_item_id: s.args.taskId } }), 0);
    assert.equal(await db.workflowEvent.count({ where: { content_item_id: s.args.taskId, command: 'x_native_consume_receipt' } }), 0);
    const nonce = await db.projectSettings.findFirst({ where: { project_id: s.args.projectId, key: { startsWith: 'x_native:challenge:' } } });
    assert.equal(JSON.parse(nonce.value).consumedSha256, null);
});
test('PostgreSQL UNKNOWN and expired lease remain reconciliation-only; revocation stops signed delegates', async t => {
    const s = await ready(t); await execution.executeNativeReceipt(s.receipt(s.challenge), deps, origin);
    const permit = await advance.advanceNativeChallenge(s.read(s.challenge, 'advance'), false, deps, origin);
    await execution.executeNativeReceipt(s.receipt(permit.challenge), deps, origin);
    const result = await advance.advanceNativeChallenge(s.read(permit.challenge, 'advance'), false, deps, origin);
    await execution.executeNativeReceipt(s.receipt(result.challenge, true), deps, origin);
    await db.workItem.update({ where: { id: s.context.workItemId }, data: { lease_expires_at: new Date(0) } });
    const recovered = await advance.advanceNativeChallenge(s.read(result.challenge, 'reconcile'), true, deps, origin);
    assert.equal(recovered.challenge.phase, 'reconcile'); assert.equal(recovered.submission_permitted, false);
    await registry.revokeNativeInstallation({ projectId: s.args.projectId, channelId: s.args.snapshot.channelId,
        actorId: s.args.actorId, installationId: s.installationId, reference: 'Synthetic owner revocation' }, deps);
    await assert.rejects(control.readNativeChallenge(s.read(recovered.challenge, 'read'), deps, origin), /INSTALLATION_INVALID/);
    assert.equal(await db.deliveryAttempt.count({ where: { content_item_id: s.args.taskId } }), 1);
    assert.equal(await db.publicationFact.count({ where: { content_item_id: s.args.taskId } }), 0);
});
test('explicit Owner instruction scopes native start and advance to the new attempt',async t=>{
 const s=await ready(t);
 await execution.executeNativeReceipt(s.receipt(s.challenge),deps,origin);
 const old=await db.deliveryAttempt.findFirst({where:{content_item_id:s.args.taskId}});
 await db.deliveryAttempt.update({where:{id:old.id},data:{error_message:'PROVIDER_RESULT_UNCERTAIN'}});
 const retained=await db.deliveryAttempt.findUnique({where:{id:old.id}});
 const {withPublicationPrincipal}=require(path.join(base,'mcp/publication-principal.js'));
 const {authorizeBrowserPublication}=require(path.join(base,'services/browser_owner_instruction.js'));
 const r=await withPublicationPrincipal({userId:Number(s.args.actorId.slice(5)),actorId:s.args.actorId,projectId:s.args.projectId,profile:'owner'},()=>authorizeBrowserPublication({...s.args,idempotencyKey:'owner-repeat',allowDuplicate:true},deps));
 const workItemId=r.browser_work_item_id;
 const lease=await lifecycle.claimBrowserPublication({...s.args,workItemId,idempotencyKey:'new-owner-claim'},deps);
 const context={...s.args,apply:false,workItemId,leaseToken:lease.lease_token,idempotencyKey:'owner-new-send'};
 const issued=await control.issueNativeChallenge({context,installationId:s.installationId,bundleSha256,phase:'start',attemptId:null},deps);
 const start=await execution.executeNativeReceipt(s.receipt(issued.challenge),deps,origin);
 assert.notEqual(start.attempt_id,old.id);
 const stage=await advance.advanceNativeChallenge(s.read(issued.challenge,'advance'),false,deps,origin);
 assert.equal(stage.challenge.phase,'permit');assert.equal(stage.challenge.attemptId,start.attempt_id);
 assert.equal((await execution.executeNativeReceipt(s.receipt(stage.challenge),deps,origin)).submission_permitted,true);
 assert.deepEqual(await db.deliveryAttempt.findUnique({where:{id:old.id}}),retained);
});
