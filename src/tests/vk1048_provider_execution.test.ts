import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { runVk1048ProviderJob, type Vk1048OfflineHarness, type Vk1048ProviderSession } from '../services/vk1048_provider_execution';
import { vkConnectorPackageSha256, type VkConnectorControl } from '../services/vk_connector_consumer_runtime';
import type { VkConnectorWallEvidence } from '../services/vk_connector_reconciliation';
const now = new Date('2026-10-13T12:00:00Z');
const text = 'Exact accepted 1048 caption'; const bytes = Buffer.from('approved-image-fixture');
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const binding = { projectId: 10 as const, taskId: 1048 as const, channelId: 117 as const, communityId: -240051152 as const,
    revision: 1 as const, selectedAssetId: 130 as const, placement: 'feed' as const,
    bodySha256: hash(text), assetSha256: hash(bytes), releaseSha256: 'c'.repeat(64) };
const input = { identity: { projectId: 10, actorId: 'user:0', hostId: 'vk-connector-local-1048', instanceId: '00000000-0000-4000-8000-000000000001', buildVersion: 'fixture' },
    jobId: '00000000-0000-4000-8000-000000000002', generation: 1, packageSha256: vkConnectorPackageSha256(binding), binding };
function fixture(t: TestContext) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vk1048-fixture-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const calls: string[] = [];
    const evidence: VkConnectorWallEvidence = { ownerId: '-240051152', capturedAt: now.toISOString(), startedAt: now.toISOString(),
        windowStart: '2026-10-10T12:00:00Z', windowEnd: now.toISOString(), coverage: 'partial', exhausted: false, rows: [] };
    const acknowledgement = { assetSha256: binding.assetSha256, providerMediaId: 'photo-240051152_123', providerObjectId: '-240051152_99', acknowledged: true as const };
    const session: Vk1048ProviderSession = { cancelPendingOperations: async () => { calls.push('cancel_session'); }, reconcile: async () => evidence, mediaAcknowledgement: async () => acknowledgement,
        ui: { navigate: async () => { calls.push('navigate'); }, loginRequired: async () => false,
            openWallComposer: async () => { calls.push('composer'); }, setPostText: async (body) => { assert.equal(body, text); },
            attachImage: async () => { calls.push('upload'); }, captureScreenshot: async (file) => fs.writeFileSync(file, 'fixture-evidence'),
            submitPost: async () => { calls.push('submit'); }, readbackPost: async () => ({ public_url: 'https://vk.com/wall-240051152_99',
                provider_object_id: '-240051152_99', owner_id: '-240051152', published_at: now.toISOString(), text, image_present: true,
                provider_timestamp_source: 'provider', post_baseline_captured_at: now.toISOString(), post_baseline_object_ids: [],
                post_submission_started_at: now.toISOString(), readback_observed_at: now.toISOString() }) } };
    const harness: Vk1048OfflineHarness = { executionContext: 'offline_fixture', evidenceDir: root,
        admission: { assess: async () => ({ status: 'OFFLINE_FIXTURE_ADMITTED', executionContext: 'offline_fixture' }) },
        now: () => now, withSession: async (run) => run(session), loadApprovedImage: async () => ({ buffer: bytes, filename: 'approved.png', contentType: 'image/png' }) };
    const control: VkConnectorControl = { close: async () => {}, call: async (name, args) => {
        calls.push(name);
        if (name === 'ba_get_vk_connector_execution_package') return { binding, packageSha256: input.packageSha256, body: text,
            asset: { id: 130, url: 'https://cdn.example/approved.png', sha256: binding.assetSha256 }, approvalReference: 'owner-exact-release',
            releasedAt: evidence.windowStart, lease: null, permissionStatus: 'PERMITTED', providerExecution: 'permitted' };
        if (name === 'ba_claim_vk_connector_execution') return { workItemId: 1699, leaseToken: 'synthetic-test-lease', leaseExpiresAt: '2026-10-13T13:00:00Z', generation: 2 };
        if (name === 'ba_check_vk_connector_execution') return { status: 'validated', generation: 2 };
        if (name === 'ba_start_vk_connector_submission') return { status: 'started', attempt_id: 1 };
        if (name === 'ba_confirm_vk_connector_submission') { assert.equal(args.generation, 2); return { publication_fact_id: 9 }; }
        if (name === 'ba_reconcile_vk_connector_execution') return { factId: 9, publicUrl: 'https://vk.com/wall-240051152_99' };
        if (name === 'ba_mark_vk_connector_submission_uncertain') {
            assert.equal(args.reasonCode, 'PROVIDER_VERIFICATION_REQUIRED');
            assert.match(String(args.reasonCode), /^[A-Z_]{1,100}$/);
            return { status: 'verification_required' };
        }
        throw new Error('Unexpected test operation');
    } };
    return { evidence, calls, harness, control, session, acknowledgement };
}
test('PROVIDER-001 production permission is unverified and no browser/control action occurs', async () => {
    let calls = 0;
    const result = await runVk1048ProviderJob({}, { close: async () => {}, call: async () => { calls += 1; } });
    assert.equal(result.status, 'PERMISSION_UNVERIFIED'); assert.equal(calls, 0);
    assert.equal(result.restriction?.observedAt, '2026-10-08');
});
test('PROVIDER-002 UNKNOWN reconciliation permits no claim/upload/submit', async (t) => {
    const f = fixture(t); const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'verification_required');
    assert.equal(f.calls.some((name) => /claim|upload|submit/.test(name)), false);
});
test('PROVIDER-003 exact existing object reconciles without a lease or new provider submit', async (t) => {
    const f = fixture(t); f.evidence.coverage = 'complete_window'; f.evidence.exhausted = true; f.evidence.rows = [{ objectId: '-240051152_99', publicUrl: 'https://vk.com/wall-240051152_99',
        publishedAt: '2026-10-12T12:00:00Z', text, media: { assetSha256: binding.assetSha256, providerMediaId: 'photo-240051152_123', acknowledged: true } }];
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'offline_fixture_confirmed'); assert.equal(result.reason, 'EXACT_EXISTING_OBJECT');
    assert.equal(f.calls.some((name) => /claim|upload|submit/.test(name)), false);
});
test('PROVIDER-004 proven absence reuses worker and durable start precedes one upload/submit', async (t) => {
    const f = fixture(t); f.evidence.coverage = 'complete_window'; f.evidence.exhausted = true;
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'offline_fixture_confirmed');
    assert.ok(f.calls.indexOf('ba_start_vk_connector_submission') < f.calls.indexOf('upload'));
    assert.equal(f.calls.filter((name) => name === 'submit').length, 1);
    assert.equal(result.factId, 9);
});
test('PROVIDER-005 missing media acknowledgement never confirms visible-image-only result', async (t) => {
    const f = fixture(t); f.evidence.coverage = 'complete_window'; f.evidence.exhausted = true;
    f.session.mediaAcknowledgement = async () => null;
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'verification_required');
    assert.equal(f.calls.includes('ba_confirm_vk_connector_submission'), false);
    assert.equal(f.calls.includes('ba_mark_vk_connector_submission_uncertain'), true);
});
test('PROVIDER-006 wrong downloaded asset hash prevents provider lifecycle and lease', async (t) => {
    const f = fixture(t); f.harness.loadApprovedImage = async () => ({ buffer: Buffer.from('wrong-asset'), filename: 'approved.png' });
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'verification_required');
    assert.equal(f.calls.includes('navigate'), false); assert.equal(f.calls.includes('ba_claim_vk_connector_execution'), false);
});
test('PROVIDER-007 uncertain existing durable attempt forbids upload and submit on restart', async (t) => {
    const f = fixture(t); f.evidence.coverage = 'complete_window'; f.evidence.exhausted = true;
    const original = f.control.call;
    f.control.call = async (name, args) => name === 'ba_start_vk_connector_submission'
        ? { status: 'verification_required', attempt_id: 1, retry_allowed: false } : original(name, args);
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'verification_required'); assert.equal(f.calls.includes('upload'), false); assert.equal(f.calls.includes('submit'), false);
});
test('PROVIDER-008 lost generation fence immediately before upload performs zero upload and submit', async (t) => {
    const f = fixture(t); f.evidence.coverage = 'complete_window'; f.evidence.exhausted = true;
    const original = f.control.call;
    f.control.call = async (name, args) => {
        if (name === 'ba_check_vk_connector_execution') throw new Error('generation changed');
        return original(name, args);
    };
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'verification_required');
    assert.equal(f.calls.includes('upload'), false); assert.equal(f.calls.includes('submit'), false);
});
test('PROVIDER-009 lease fence lost after upload prevents submit and freezes the durable attempt', async (t) => {
    const f = fixture(t); f.evidence.coverage = 'complete_window'; f.evidence.exhausted = true;
    const original = f.control.call; let checks = 0;
    f.control.call = async (name, args) => {
        if (name === 'ba_check_vk_connector_execution' && ++checks === 2) throw new Error('lease retired');
        return original(name, args);
    };
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'verification_required');
    assert.equal(f.calls.filter((name) => name === 'upload').length, 1);
    assert.equal(f.calls.includes('submit'), false);
    assert.equal(f.calls.includes('ba_mark_vk_connector_submission_uncertain'), true);
});
test('PROVIDER-010 NOT_CHECKED protected package cannot call provider even with an injected fixture admission', async (t) => {
    const f = fixture(t); const original = f.control.call;
    f.control.call = async (name, args) => {
        const output = await original(name, args);
        return name === 'ba_get_vk_connector_execution_package'
            ? { ...(typeof output === 'object' && output !== null ? output : {}), permissionStatus: 'NOT_CHECKED', providerExecution: 'blocked' } : output;
    };
    let sessions = 0; f.harness.withSession = async (run) => { sessions += 1; return run(f.session); };
    assert.equal((await runVk1048ProviderJob(input, f.control, f.harness)).status, 'verification_required');
    assert.equal(sessions, 0);
});
test('PROVIDER-011 missing absolute provider date/source proof cannot confirm a visible matching image', async (t) => {
    const f = fixture(t); f.evidence.coverage = 'complete_window'; f.evidence.exhausted = true;
    f.session.ui.readbackPost = async () => ({ public_url: 'https://vk.com/wall-240051152_99', provider_object_id: '-240051152_99',
        owner_id: '-240051152', published_at: now.toISOString(), text, image_present: true });
    assert.equal((await runVk1048ProviderJob(input, f.control, f.harness)).status, 'verification_required');
    assert.equal(f.calls.includes('ba_confirm_vk_connector_submission'), false);
});
test('PROVIDER-012 reconciliation timeout cancels owned session and late evidence permits no claim', async (t) => {
    const f = fixture(t); let finish: ((value: VkConnectorWallEvidence) => void) | undefined;
    f.harness.operationTimeoutMs = 10;
    f.session.reconcile = async () => new Promise((resolve) => { finish = resolve; });
    const result = await runVk1048ProviderJob(input, f.control, f.harness);
    assert.equal(result.status, 'verification_required');
    finish?.({ ...f.evidence, coverage: 'complete_window', exhausted: true });
    await Promise.resolve();
    assert.equal(f.calls.includes('ba_claim_vk_connector_execution'), false);
    assert.equal(f.calls.includes('cancel_session'), true);
});
test('PROVIDER-013 server heartbeat fencing after a 31-second scan prevents lease and mutation', async (t) => {
    const f = fixture(t); let current = now;
    f.harness.now = () => current;
    f.session.reconcile = async () => {
        current = new Date(now.getTime() + 31_000);
        return { ...f.evidence, coverage: 'complete_window', exhausted: true,
            capturedAt: current.toISOString(), windowEnd: current.toISOString() };
    };
    const original = f.control.call;
    f.control.call = async (name, args) => {
        if (name === 'ba_claim_vk_connector_execution') throw new Error('authoritative host heartbeat expired');
        return original(name, args);
    };
    assert.equal((await runVk1048ProviderJob(input, f.control, f.harness)).status, 'verification_required');
    assert.equal(f.calls.includes('upload'), false); assert.equal(f.calls.includes('submit'), false);
});
