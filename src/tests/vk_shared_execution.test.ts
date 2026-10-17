import assert from 'node:assert/strict';
import test from 'node:test';
import { VkConnectorExecutionService } from '../services/vk_connector_execution.service';
import { VkConnectorDispatchService } from '../services/vk_connector_dispatch.service';
import { connectorHash, connectorPackageHash, type ConnectorBinding, type ConnectorJob, type ConnectorStore,
    type ConnectorSnapshot, type ConnectorRepository, type ConnectorHost } from '../services/vk_connector_contract';
import type { VkConnectorExecutionPorts } from '../services/vk_connector_execution_contract';
import type { VkConnectorWallEvidence } from '../services/vk_connector_reconciliation';
const clock = new Date('2026-10-17T12:00:00Z');
function fixture(projectId: number, taskId: number, channelId: number, communityId: number, workItemId: number) {
    const actorId = `user:${projectId}`;
    const binding: ConnectorBinding = { projectId, taskId, channelId, communityId, revision: 3, selectedAssetId: taskId + 20,
        placement: 'feed', bodySha256: connectorHash('accepted body'), assetSha256: 'b'.repeat(64), releaseSha256: 'c'.repeat(64) };
    const snapshot: ConnectorSnapshot = { package: binding, workItemId, factId: null, publicUrl: null, attemptId: null, attemptStatus: null, eligible: true };
    const identity = { projectId, actorId, hostId: `registered-${projectId}`, instanceId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        jobId: `bbbbbbbb-bbbb-4bbb-abbb-${String(taskId).padStart(12, '0')}`, generation: 1, packageSha256: connectorPackageHash(binding) };
    const job: ConnectorJob = { ...identity, taskId, channelId, workItemId, package: binding, idempotencyKey: 'fixture-job', state: 'accepted',
        receiptAt: clock, updatedAt: clock, blocker: null, attemptId: null, factId: null };
    const host: ConnectorHost = { ...identity, buildVersion: 'fixture', heartbeatAt: clock, mode: 'vk_feed_provider', blocker: null };
    const events: Array<{ projectId: number; taskId: number | null }> = []; let sends = 0; let claims = 0;
    const store: ConnectorStore = { authorize: async (p, a) => { assert.equal(p, projectId); assert.equal(a, actorId); },
        snapshot: async (p, t) => { assert.equal(p, projectId); assert.equal(t, taskId); return structuredClone(snapshot); },
        executionPackage: async (p, t) => { assert.equal(p, projectId); assert.equal(t, taskId); return { binding, packageSha256: identity.packageSha256,
            body: 'accepted body', asset: { id: binding.selectedAssetId, url: 'https://fixture.invalid/image', sha256: binding.assetSha256 },
            workItemId, approvalReference: 'fixture-owner-release', releasedAt: '2026-10-17T11:00:00Z', permissionStatus: 'PERMITTED', providerExecution: 'permitted' }; },
        job: async (p, id) => p === projectId && id === job.jobId ? structuredClone(job) : null,
        host: async (p, id) => p === projectId && id === host.hostId ? structuredClone(host) : null,
        updateJob: async (id, generation, state, patch) => { if (id !== job.jobId || generation !== job.generation || state !== job.state) return false; Object.assign(job, patch); return true; },
        bindLease: async (p, a) => { assert.equal(p, projectId); assert.equal(a, actorId); },
        event: async (p, t) => { events.push({ projectId: p, taskId: t }); },
        jobByKey: async () => null, jobByPackage: async () => null, insertJob: async () => { throw new Error('No new job'); },
        candidates: async () => [], saveHost: async () => { throw new Error('No new host'); } };
    const repository: ConnectorRepository = { transaction: async run => run(store) };
    const evidence: VkConnectorWallEvidence = { ownerId: String(communityId), startedAt: clock.toISOString(), capturedAt: clock.toISOString(),
        windowStart: '2026-10-17T11:00:00Z', windowEnd: clock.toISOString(), coverage: 'complete_window', exhausted: true, rows: [] };
    const ports: VkConnectorExecutionPorts = { admission: async () => 'PERMITTED', verifyEvidence: async () => evidence, verifyMediaAcknowledgement: async () => true,
        claimLease: async args => { assert.equal(args.projectId, projectId); assert.equal(args.workItemId, workItemId); claims++; return { leaseToken: 'synthetic-lease', leaseExpiresAt: '2026-10-17T12:30:00Z' }; },
        checkLease: async args => { assert.equal(args.leaseToken, 'synthetic-lease'); },
        start: async () => { sends++; snapshot.attemptId = 9; snapshot.attemptStatus = 'pending'; return { status: 'started', attempt_id: 9 }; },
        confirm: async () => { snapshot.factId = 15; snapshot.publicUrl = `https://vk.com/wall${communityId}_71`; return { publication_fact_id: 15 }; },
        uncertain: async () => ({ status: 'verification_required' }), recordMatchedFact: async () => { throw new Error('No reconciled fact expected'); } };
    const dispatch = new VkConnectorDispatchService(repository, true, () => clock);
    const execution = new VkConnectorExecutionService(dispatch, repository, ports, () => clock);
    return { identity, binding, execution, events, snapshot, job, evidence, claims: () => claims, sends: () => sends };
}
for (const dataset of [[21, 5101, 601, -7101, 8101], [22, 5202, 602, -7202, 8202]]) {
    test(`VK022 shared execution resolves immutable data for tenant ${dataset[0]} without task-specific authority`, async () => {
        const [p, t, c, owner, work] = dataset; assert.ok(p && t && c && owner && work);
        const f = fixture(p, t, c, owner, work); const lease = await f.execution.claim({ ...f.identity, evidence: f.evidence });
        assert.equal(lease.workItemId, work); assert.equal(f.claims(), 1);
        const args = { ...f.identity, generation: lease.generation, taskId: t, channelId: c, workItemId: work, leaseToken: lease.leaseToken,
            approvalReference: 'fixture-owner-release', contentRevision: f.binding.revision, textSha256: f.binding.bodySha256,
            imageSha256: f.binding.assetSha256, selectedAssetId: f.binding.selectedAssetId, placement: 'feed' as const, idempotencyKey: 'fixture-attempt' };
        await f.execution.start(args);
        await f.execution.confirm({ ...args, attemptId: 9, providerObjectId: `${owner}_71`, publicUrl: `https://vk.com/wall${owner}_71`,
            publishedAt: clock.toISOString(), evidenceSha256: 'd'.repeat(64), providerTimestampSource: 'provider', postBaselineCapturedAt: clock.toISOString(),
            postBaselineObjectIds: [], postSubmissionStartedAt: clock.toISOString(), readbackObservedAt: clock.toISOString(),
            mediaAcknowledgement: { assetSha256: f.binding.assetSha256, providerMediaId: `photo${owner}_72`, providerObjectId: `${owner}_71`, acknowledged: true } });
        assert.equal(f.sends(), 1); assert.equal(f.snapshot.factId, 15); assert.ok(f.events.every(event => event.projectId === p && event.taskId === t));
    });
}
test('VK022 foreign principal and partial inventory cannot acquire a lease or send', async () => {
    const f = fixture(23, 5303, 603, -7303, 8303);
    await assert.rejects(f.execution.claim({ ...f.identity, projectId: 99, evidence: f.evidence }));
    f.evidence.coverage = 'partial';
    await assert.rejects(f.execution.claim({ ...f.identity, evidence: f.evidence }), /VERIFICATION_REQUIRED/);
    assert.equal(f.claims(), 0); assert.equal(f.sends(), 0);
});

test('VK022 wall-photo inventory cannot authorize a Clip submission', async () => {
    const f = fixture(24, 5404, 604, -7404, 8404);
    f.binding.placement = 'clip'; f.identity.packageSha256 = connectorPackageHash(f.binding); f.job.packageSha256 = f.identity.packageSha256;
    await assert.rejects(f.execution.claim({ ...f.identity, evidence: f.evidence }), /FORMAT_UNSUPPORTED/);
    assert.equal(f.claims(), 0); assert.equal(f.sends(), 0);
});

test('VK022 changed canonical binding and started attempts never gain a second send', async () => {
    const f = fixture(25, 5505, 605, -7505, 8505);
    const lease = await f.execution.claim({ ...f.identity, evidence: f.evidence });
    const args = { ...f.identity, generation: lease.generation, taskId: f.binding.taskId, channelId: f.binding.channelId,
        workItemId: lease.workItemId, leaseToken: lease.leaseToken, approvalReference: 'fixture-owner-release', contentRevision: f.binding.revision,
        textSha256: f.binding.bodySha256, imageSha256: f.binding.assetSha256, selectedAssetId: f.binding.selectedAssetId,
        placement: 'feed' as const, idempotencyKey: 'fixture-attempt' };
    for (const change of [{ channelId: 999 }, { contentRevision: 99 }, { selectedAssetId: 999 }, { textSha256: 'e'.repeat(64) }, { approvalReference: 'another-owner-release' }]) {
        await assert.rejects(f.execution.start({ ...args, ...change }), /PACKAGE_CHANGED/);
    }
    assert.equal(f.sends(), 0);
    await f.execution.start(args);
    await assert.rejects(f.execution.claim({ ...f.identity, generation: lease.generation, evidence: f.evidence }), /VERIFICATION_REQUIRED|FENCED/);
    assert.equal(f.sends(), 1);
});
