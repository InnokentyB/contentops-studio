import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { harness } from './helpers/vk_connector_harness';
import { VkConnectorAppAuthority } from '../services/vk_connector_app_authority';
import { connectorHash, connectorPackageHash } from '../services/vk_connector_contract';
import { createVkConnectorApplicationBroker } from '../services/vk_connector_application_broker';
import { createVkConnectorSubmissionControl, runVkConnectorProviderJob } from '../services/vk_connector_provider_execution';
import type { VkConnectorProviderRuntime } from '../services/vk_connector_playwright_runtime';
import type { VkConnectorControl } from '../services/vk_connector_consumer_runtime';
const now = new Date('2026-10-12T19:00:00Z');
async function setup() {
    const h = harness(true, 'vk_feed_provider'); h.store.authorize = async (project, actor) => { assert.equal(project, 10); assert.equal(actor, 'user:2'); };
    const bytes = Buffer.from('fixture image'); h.snapshot.package.bodySha256 = connectorHash('fixture body'); h.snapshot.package.assetSha256 = connectorHash(bytes.toString());
    await h.service.dispatch({ ...h.request, actorId: 'user:2', expectedPackageSha256: connectorPackageHash(h.snapshot.package) });
    const consumer = { ...h.consumer, projectId: 10 as const, hostId: 'vk-connector-local-1048' as const, actorId: 'user:2' as const, mode: 'vk_feed_provider' as const };
    const [job] = (await h.service.poll(consumer)).jobs; const receipt = await h.service.ack({ ...consumer, ...job });
    const identity = { ...consumer, jobId: receipt.jobId, generation: receipt.generation, packageSha256: receipt.packageSha256 };
    h.store.executionPackage = async () => ({ binding: h.snapshot.package, packageSha256: receipt.packageSha256, body: 'fixture body',
        asset: { id: 130, url: 'https://fixture.test/image', sha256: h.snapshot.package.assetSha256 }, approvalReference: 'fixture-owner-release',
        releasedAt: '2026-10-12T18:00:00Z', workItemId: 1699, permissionStatus: 'NOT_CHECKED', providerExecution: 'blocked' });
    const authority = new VkConnectorAppAuthority(h.service, h.repository, () => now, async () => ({ verified: true }));
    return { h, bytes, identity, authority };
}
test('BROKER-SERVICE-001 real authority receives wall envelope and challenge precedes protected package', async () => {
    const { h, bytes, identity, authority } = await setup(); let verified = false;
    const control: VkConnectorControl = { close: async () => undefined, call: async (name, args) => {
        if (name === 'ba_issue_vk_connector_challenge') return authority.issue({ ...identity, purpose: z.enum(['wall_read','submission','post_confirm']).parse(args.purpose) });
        if (name === 'ba_get_vk_connector_execution_package') {
            assert.equal(await authority.admission(identity), 'PERMITTED');
            return { ...await h.service.executionPackage(identity), lease: null, permissionStatus: 'PERMITTED', providerExecution: 'permitted' };
        }
        if (name === 'ba_reconcile_vk_connector_execution') {
            const proof = await authority.verifyEvidence(identity, await h.service.executionPackage(identity), args.evidence);
            assert.ok(proof); verified = true; return { factId: 4, publicUrl: 'https://vk.com/wall-240051152_7' };
        }
        throw new Error(`Unexpected test route ${name}`);
    } };
    const broker = createVkConnectorApplicationBroker(control, identity, () => now);
    const runtime: VkConnectorProviderRuntime = { route: 'planner_registered_independent_adapter', broker, executionContext: 'production_admitted', evidenceDir: '/unused', now: () => now,
        admission: { assess: async () => ({ status: 'ACTION_ADMITTED', executionContext: 'production_admitted' }) },
        loadApprovedImage: async () => ({ buffer: bytes, filename: 'fixture.png' }), withSession: async run => run({
            ui: { navigate: async () => undefined, loginRequired: async () => false, openWallComposer: async () => undefined,
                setPostText: async () => undefined, attachImage: async () => undefined, captureScreenshot: async () => undefined },
            cancelPendingOperations: async () => undefined, mediaAcknowledgement: async () => null,
            reconcile: async () => ({ ownerId: '-240051152', startedAt: now.toISOString(), capturedAt: now.toISOString(), windowStart: '2026-10-12T18:00:00Z', windowEnd: now.toISOString(),
                coverage: 'complete_window', exhausted: true, rows: [{ objectId: '-240051152_7', publicUrl: 'https://vk.com/wall-240051152_7', publishedAt: now.toISOString(), text: 'fixture body',
                    media: { assetSha256: h.snapshot.package.assetSha256, providerMediaId: 'photo-240051152_8', acknowledged: true,
                        source: { originalUrl: 'https://sun9.userapi.com/original.png', capturedAt: now.toISOString(), postObjectId: '-240051152_7', providerMediaId: 'photo-240051152_8' } } }] }) }) };
    const result = await runVkConnectorProviderJob({ identity: consumerIdentity(identity), jobId: identity.jobId, generation: identity.generation,
        packageSha256: identity.packageSha256, binding: h.snapshot.package }, control, runtime);
    assert.equal(result.status, 'provider_confirmed'); assert.equal(verified, true);
});
function consumerIdentity(identity: { projectId: number; actorId: string; hostId: string; instanceId: string; buildVersion: string }) {
    return { projectId: identity.projectId, actorId: identity.actorId, hostId: identity.hostId, instanceId: identity.instanceId, buildVersion: identity.buildVersion };
}
test('BROKER-SERVICE-002 confirmation projection passes actual strict authority and keeps lease outside evidence', async () => {
    const { h, identity, authority } = await setup(); const job = h.jobs.get(identity.jobId); assert.ok(job); job.state = 'executing'; job.attemptId = 51;
    const execution = await h.service.executionPackage(identity); let confirmed = false;
    const fields = { providerObjectId: '-240051152_61', publicUrl: 'https://vk.com/wall-240051152_61', publishedAt: now.toISOString(),
        evidenceSha256: 'f'.repeat(64), providerTimestampSource: 'provider' as const, postBaselineCapturedAt: now.toISOString(),
        postBaselineObjectIds: [], postSubmissionStartedAt: now.toISOString(), readbackObservedAt: now.toISOString() };
    const ack = { assetSha256: h.snapshot.package.assetSha256, providerMediaId: 'photo-240051152_55', acknowledged: true as const,
        providerObjectId: fields.providerObjectId, source: { originalUrl: 'https://sun9.userapi.com/original.png', capturedAt: now.toISOString(), postObjectId: fields.providerObjectId, providerMediaId: 'photo-240051152_55' } };
    const control: VkConnectorControl = { close: async () => undefined, call: async (name, args) => {
        if (name === 'ba_issue_vk_connector_challenge') return authority.issue({ ...identity, purpose: 'post_confirm' });
        if (name === 'ba_check_vk_connector_execution') return { status: 'validated', generation: identity.generation };
        if (name === 'ba_confirm_vk_connector_submission') {
            assert.equal(JSON.stringify(args.providerAttestation).includes('fixture-lease'), false);
            confirmed = await authority.verifyMediaAcknowledgement({ ...identity, ...fields, taskId: 1048, channelId: 117, workItemId: 1699,
                leaseToken: 'fixture-lease', approvalReference: execution.approvalReference, idempotencyKey: 'fixture', contentRevision: 1,
                textSha256: h.snapshot.package.bodySha256, imageSha256: h.snapshot.package.assetSha256, selectedAssetId: 130, placement: 'feed', attemptId: 51,
                mediaAcknowledgement: { assetSha256: ack.assetSha256, providerMediaId: ack.providerMediaId, acknowledged: true, providerObjectId: ack.providerObjectId }, providerAttestation: args.providerAttestation }, execution);
            assert.equal(confirmed, true); return { publication_fact_id: 4 };
        }
        throw new Error('Unexpected test route');
    } };
    const broker = createVkConnectorApplicationBroker(control, identity, () => now); await broker.authorize('post_confirm');
    const shim = createVkConnectorSubmissionControl({ identity, jobId: identity.jobId, generation: identity.generation, packageSha256: identity.packageSha256 }, h.snapshot.package, control,
        { ui: { navigate: async () => undefined, loginRequired: async () => false, openWallComposer: async () => undefined, setPostText: async () => undefined, attachImage: async () => undefined, captureScreenshot: async () => undefined },
            reconcile: async () => { throw new Error('unused'); }, cancelPendingOperations: async () => undefined, mediaAcknowledgement: async () => ack }, undefined, () => now, 30_000, broker);
    await shim.confirm({ project_id: 10, task_id: 1048, channel_id: 117, work_item_id: 1699, lease_token: 'fixture-lease', approval_reference: execution.approvalReference,
        content_revision: 1, text_sha256: h.snapshot.package.bodySha256, image_sha256: h.snapshot.package.assetSha256, selected_asset_id: 130, placement: 'feed', idempotency_key: 'fixture', attempt_id: 51,
        public_url: fields.publicUrl, provider_object_id: fields.providerObjectId, published_at: fields.publishedAt, evidence_sha256: fields.evidenceSha256,
        provider_timestamp_source: 'provider', post_baseline_captured_at: fields.postBaselineCapturedAt, post_baseline_object_ids: [], post_submission_started_at: fields.postSubmissionStartedAt, readback_observed_at: fields.readbackObservedAt });
    assert.equal(confirmed, true);
});
