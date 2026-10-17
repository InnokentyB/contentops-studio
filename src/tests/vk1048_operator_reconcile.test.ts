import assert from 'node:assert/strict';
import test from 'node:test';
import { runVkConnectorOperatorReconcile } from '../services/vk_connector_operator_reconcile';
import { vkConnectorPackageSha256, type VkConnectorConfig, type VkConnectorControl, type VkConnectorIdentity } from '../services/vk_connector_consumer_runtime';
test('OPERATOR-RECONCILE-001 only exact frozen pilot job is rebound and never claims or submits', async () => {
    const jobId = '3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de'; const binding = { projectId: 10, taskId: 1048, channelId: 117,
        communityId: -240051152, revision: 1, selectedAssetId: 130, placement: 'feed', bodySha256: 'a'.repeat(64), assetSha256: 'b'.repeat(64), releaseSha256: 'c'.repeat(64) };
    const digest = vkConnectorPackageSha256(binding); const calls: string[] = [];
    const identity: VkConnectorIdentity = { projectId: 10, actorId: 'user:0', hostId: 'vk-connector-local-1048', instanceId: '00000000-0000-4000-8000-000000000001', buildVersion: 'fixture', mode: 'vk_feed_provider' };
    const config: VkConnectorConfig = { projectId: 10, hostId: identity.hostId, endpoint: 'https://planner-mcp-production.up.railway.app/mcp/publisher', runtimeDir: '/unused', mode: 'vk_feed_provider', buildVersion: 'fixture', tokenEnvVar: 'CONTENTOPS_ANALYSTCRAFT_PUBLISHER_TOKEN' };
    const control: VkConnectorControl = { close: async () => undefined, call: async (name, args) => {
        calls.push(name);
        if (name === 'ba_poll_vk_connector_jobs') return { jobs: [] };
        assert.equal(args.jobId, jobId);
        if (name === 'ba_get_vk_connector_job') return { jobId, generation: 4, packageSha256: digest, state: 'verification_required' };
        if (name === 'ba_rebind_vk_connector_reconciliation') { assert.equal(args.generation, 4); return { jobId, generation: 5, packageSha256: digest, state: 'verification_required' }; }
        if (name === 'ba_get_vk_connector_execution_package') { assert.equal(args.generation, 5); return { binding, packageSha256: digest }; }
        throw new Error('Unexpected operator recovery mutation');
    } };
    const result = await runVkConnectorOperatorReconcile(config, identity, control, jobId, undefined, async input => {
        assert.equal(input.generation, 5); return { status: 'verification_required', executionContext: 'production_admitted', reason: 'RECONCILIATION_ONLY' };
    });
    assert.equal(result.reason, 'RECONCILIATION_ONLY'); assert.equal(calls.some(name => /claim|submit|resume|dispatch/.test(name)), false);
});
