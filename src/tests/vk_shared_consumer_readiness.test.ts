import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VkConnectorConfigSchema, consumeVkConnectorOnce, type VkConnectorControl } from '../services/vk_connector_consumer_runtime';
import { runVkOperatorPreflight } from '../services/vk_operator_preflight';

const datasets = [
    { projectId: 21, taskId: 2101, channelId: 211, communityId: -21101, revision: 2, selectedAssetId: 212, hostId: 'owned-host-alpha', jobId: '10000000-0000-4000-8000-000000000001' },
    { projectId: 31, taskId: 3101, channelId: 311, communityId: -31101, revision: 4, selectedAssetId: 312, hostId: 'owned-host-beta', jobId: '20000000-0000-4000-8000-000000000002' }
];
function fixture(data: typeof datasets[number]) {
    const binding = { projectId: data.projectId, taskId: data.taskId, channelId: data.channelId, communityId: data.communityId,
        revision: data.revision, selectedAssetId: data.selectedAssetId, placement: 'feed', bodySha256: 'a'.repeat(64), assetSha256: 'b'.repeat(64), releaseSha256: 'c'.repeat(64) };
    const packageSha256 = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
    const config = { projectId: data.projectId, hostId: data.hostId, endpoint: 'https://planner-mcp-production.up.railway.app/mcp/publisher',
        tokenEnvVar: 'CONTENTOPS_SYNTHETIC_PUBLISHER_TOKEN', runtimeDir: '/synthetic/runtime', mode: 'infrastructure_only', buildVersion: 'fixture' };
    const identity = { projectId: data.projectId, actorId: 'user:0', hostId: data.hostId,
        instanceId: '00000000-0000-4000-8000-000000000003', mode: 'infrastructure_only', buildVersion: 'fixture' };
    const job = { jobId: data.jobId, state: 'blocked', generation: 3, packageSha256, attemptId: null, factId: null };
    const pollJob = { jobId: data.jobId, state: 'queued', generation: 0, packageSha256, package: binding };
    const calls: string[] = [];
    const control: VkConnectorControl = { close: async () => undefined, call: async (name, args) => {
        calls.push(name); assert.equal(args.projectId, data.projectId);
        if (name === 'ba_poll_vk_connector_jobs') return { jobs: [pollJob],
            health: { hostId: data.hostId, mode: args.mode, providerExecution: 'blocked', status: 'online', heartbeatAt: new Date().toISOString() } };
        if (name === 'ba_ack_vk_connector_job') return { ...job, state: 'accepted', generation: 1 };
        if (name === 'ba_report_vk_connector_job') return { ...job, generation: 1, blocker: args.blocker };
        if (name === 'ba_preview_vk_connector_dispatch') { assert.equal(args.taskId, data.taskId); return { package: binding, packageSha256 }; }
        if (name === 'ba_get_vk_connector_job') { assert.equal(args.jobId, data.jobId); return job; }
        if (name === 'ba_get_vk_connector_health') return { hostId: data.hostId, status: 'online', heartbeatAt: new Date().toISOString() };
        throw new Error('Unexpected control operation');
    } };
    return { binding, config, identity, job, pollJob, packageSha256, control, calls };
}

test('VK022 shared private config and consumer process two independent tenant/host/package datasets through the same code', async () => {
    for (const data of datasets) {
        const f = fixture(data);
        assert.equal(VkConnectorConfigSchema.parse(f.config).projectId, data.projectId);
        const result = await consumeVkConnectorOnce(f.identity, f.control);
        assert.equal(result.status, 'receipt_provider_blocked'); assert.equal(result.providerExecution, 'blocked');
        assert.equal(result.receipts[0]?.jobId, data.jobId);
    }
});

test('VK022 foreign tenant or tampered immutable package cannot be acknowledged', async () => {
    for (const data of datasets) {
        const f = fixture(data), original = f.control.call;
        f.control.call = async (name, args) => name === 'ba_poll_vk_connector_jobs'
            ? { jobs: [{ ...f.pollJob, package: { ...f.binding, projectId: data.projectId + 1 } }],
                health: { hostId: data.hostId, mode: 'infrastructure_only', providerExecution: 'blocked', status: 'online', heartbeatAt: new Date().toISOString() } }
            : original(name, args);
        assert.equal((await consumeVkConnectorOnce(f.identity, f.control)).status, 'invalid_response');
        assert.equal(f.calls.includes('ba_ack_vk_connector_job'), false);
    }
});

test('VK022 explicit readiness request validates the requested existing job and exposes distinct unassessed states without live permission', async () => {
    for (const data of datasets) {
        const f = fixture(data);
        const options = { request: { taskId: data.taskId, jobId: data.jobId, expectedPackageSha256: f.packageSha256 },
            resources: () => ({ profile: 'UNCONFIGURED' as const, evidence: 'UNCONFIGURED' as const, dependency: 'PASS' as const }) };
        const result = await runVkOperatorPreflight(f.config, f.control, options);
        assert.ok(result.scope); assert.equal(result.scope.taskId, data.taskId); assert.equal(result.scope.jobId, data.jobId);
        const diagnostics = Reflect.get(result, 'diagnostics');
        assert.ok(diagnostics && typeof diagnostics === 'object');
        assert.equal(Reflect.get(diagnostics, 'controlPlane'), 'CONNECTED');
        assert.equal(Reflect.get(diagnostics, 'applicationAuthorization'), 'NOT_ASSESSED');
        assert.equal(Reflect.get(diagnostics, 'providerReadiness'), 'NOT_CHECKED');
        assert.equal(result.productionReady, false);
        assert.deepEqual(new Set(f.calls), new Set(['ba_preview_vk_connector_dispatch','ba_get_vk_connector_job','ba_get_vk_connector_health']));
    }
});

test('VK022 normal consumer cannot activate an injected operator runtime while the recorded restriction remains', async () => {
    const f = fixture({ ...datasets[0], projectId: 10, taskId: 1048, channelId: 117, communityId: -240051152,
        revision: 1, selectedAssetId: 130, hostId: 'vk-connector-local-1048' });
    const original = f.control.call;
    f.control.call = async (name, args) => {
        const raw = await original(name, args);
        if (name !== 'ba_poll_vk_connector_jobs') return raw;
        return { jobs: [{ ...f.pollJob, recordedRestrictions: [{
            platform: 'vk', ownerId: String(f.binding.communityId), operation: 'publication', observedAt: '2026-10-13T00:00:00.000Z',
            basis: 'Historical recorded browser-control site-safety denial; no indirect same-outcome execution' }] }],
            health: { hostId: f.identity.hostId, mode: args.mode, providerExecution: 'blocked', status: 'online', heartbeatAt: new Date().toISOString() } };
    };
    let operatorCalls = 0;
    const result = await consumeVkConnectorOnce({ ...f.identity, mode: 'vk_feed_provider' }, f.control, undefined, 15_000,
        undefined, async () => { operatorCalls++; throw new Error('Denied operator runtime must not be activated'); });
    assert.equal(operatorCalls, 0); assert.equal(result.providerExecution, 'blocked');
    assert.equal(result.status, 'receipt_provider_blocked');
});

test('VK022 authenticated actor transport sentinel is normalized server-side and cannot select another tenant', async () => {
    const { scopeRemoteMcpRequest } = await import('../mcp/remote-auth');
    const request = { method: 'tools/call', params: { name: 'ba_get_vk_connector_job', arguments: {
        projectId: 21, actorId: 'authenticated', jobId: datasets[0].jobId } } };
    const scoped = scopeRemoteMcpRequest(request, { userId: 201, actorId: 'user:201', projectId: 21, profile: 'publisher' });
    assert.equal(scoped.allowed, true);
    if (scoped.allowed) assert.equal(scoped.body.params.arguments.actorId, 'user:201');
    assert.equal(scopeRemoteMcpRequest({ ...request, params: { ...request.params, arguments: { ...request.params.arguments, projectId: 31 } } },
        { userId: 201, actorId: 'user:201', projectId: 21, profile: 'publisher' }).allowed, false);
});

test('VK022 supplied null restriction metadata fails closed before operator activation or fixture inspection', async () => {
    const f = fixture(datasets[0]);
    const original = f.control.call;
    f.control.call = async (name, args) => {
        if (name === 'ba_poll_vk_connector_jobs') return {
            jobs: [{ ...f.pollJob, recordedRestrictions: null }],
            health: { hostId: f.identity.hostId, mode: args.mode, providerExecution: 'blocked', status: 'online', heartbeatAt: new Date().toISOString() }
        };
        const raw = await original(name, args);
        return name === 'ba_get_vk_connector_job' ? { ...f.job, recordedRestrictions: null } : raw;
    };
    let operatorCalls = 0;
    const consumed = await consumeVkConnectorOnce({ ...f.identity, mode: 'vk_feed_provider' }, f.control, undefined, 15_000,
        undefined, async () => { operatorCalls++; throw new Error('Malformed metadata must not reach operator'); });
    assert.equal(operatorCalls, 0); assert.equal(consumed.status, 'auth_or_control_unavailable');
    assert.equal(f.calls.includes('ba_ack_vk_connector_job'), false);
    let inspections = 0;
    const readiness = await runVkOperatorPreflight(f.config, f.control, {
        request: { taskId: datasets[0].taskId, jobId: f.job.jobId, expectedPackageSha256: f.packageSha256 },
        resources: () => ({ profile: 'PASS', evidence: 'PASS', dependency: 'PASS' }),
        fixture: { kind: 'offline_fixture', inspect: async () => { inspections++; return {}; }, close: async () => undefined }
    });
    assert.equal(inspections, 0); assert.equal(readiness.status, 'BLOCKED');
    assert.equal(readiness.productionReady, false);
});

test('VK022 wrong requested job/hash stays blocked and control failures are not provider login failures', async () => {
    for (const data of datasets) {
        const f = fixture(data);
        const request = { taskId: data.taskId, jobId: data.jobId, expectedPackageSha256: f.packageSha256 };
        const resources = () => ({ profile: 'UNCONFIGURED' as const, evidence: 'UNCONFIGURED' as const, dependency: 'PASS' as const });
        const wrongHash = await runVkOperatorPreflight(f.config, f.control, { request: { ...request, expectedPackageSha256: 'f'.repeat(64) }, resources });
        assert.equal(wrongHash.status, 'BLOCKED'); assert.equal(wrongHash.reason, 'PACKAGE_CHANGED');
        const original = f.control.call;
        f.control.call = async (name, args) => name === 'ba_get_vk_connector_job' ? { ...f.job, jobId: '30000000-0000-4000-8000-000000000003' } : original(name, args);
        assert.equal((await runVkOperatorPreflight(f.config, f.control, { request, resources })).reason, 'JOB_SCOPE_MISMATCH');
        const failed = await runVkOperatorPreflight(f.config, { close: async () => undefined, call: async () => { throw new Error('Cookie=private-provider-payload'); } }, { request, resources });
        assert.equal(failed.diagnostics.controlPlane, 'FAILED'); assert.equal(failed.diagnostics.providerReadiness, 'NOT_CHECKED');
        assert.equal(failed.diagnostics.applicationAuthorization, 'NOT_ASSESSED'); assert.equal(JSON.stringify(failed).includes('private-provider-payload'), false);
    }
});
