import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

test('VK017-MCP: registered mutation commands reject unverified admission before provider/DB execution', async () => {
    const previous = process.env.VK_CONNECTOR_DISPATCH_ENABLED;
    process.env.VK_CONNECTOR_DISPATCH_ENABLED = '1';
    const { registerVkConnectorTools } = await import('../mcp/tools/vk_connector_tools');
    const server = new McpServer({ name: 'offline-vk017-schema', version: 'test' });
    const client = new Client({ name: 'offline-schema-client', version: 'test' });
    try {
        registerVkConnectorTools(server);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport); await client.connect(clientTransport);
        const available = new Set((await client.listTools()).tools.map(tool => tool.name));
        for (const name of ['ba_resume_vk_connector_job', 'ba_get_vk_connector_execution_package', 'ba_claim_vk_connector_execution',
            'ba_check_vk_connector_execution', 'ba_start_vk_connector_submission', 'ba_confirm_vk_connector_submission',
            'ba_mark_vk_connector_submission_uncertain', 'ba_reconcile_vk_connector_execution']) assert.ok(available.has(name));
        const identity = { projectId: 10, actorId: 'user:2', hostId: 'vk-connector-local-1048',
            instanceId: '00000000-0000-4000-8000-000000000001', jobId: '3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de',
            generation: 1, packageSha256: 'a'.repeat(64) };
        // Reconciliation may first read an already-recorded canonical fact without provider admission.
        // These mutation commands must reject unavailable admission before any database/provider action.
        const commands = [
            { name: 'ba_claim_vk_connector_execution', arguments: { ...identity, evidence: { coverage: 'complete_window', exhausted: true } } },
            { name: 'ba_check_vk_connector_execution', arguments: { ...identity, leaseToken: 'offline-fixture-lease' } },
            { name: 'ba_start_vk_connector_submission', arguments: { ...identity, taskId: 1048, channelId: 117, workItemId: 1699,
                leaseToken: 'offline-fixture-lease', approvalReference: 'offline-fixture-approval', contentRevision: 1,
                textSha256: 'a'.repeat(64), imageSha256: 'b'.repeat(64), selectedAssetId: 130, placement: 'feed', idempotencyKey: 'offline-start' } }
        ];
        for (const command of commands) {
            const result = await client.callTool(command);
            assert.equal(result.isError, true);
            assert.match(JSON.stringify(result), /VK_CONNECTOR_PROVIDER_PERMISSION_UNVERIFIED/);
            assert.doesNotMatch(JSON.stringify(result), /offline-fixture-lease|DATABASE_URL|Authorization/);
        }
        const malformed = await client.callTool({ name: 'ba_mark_vk_connector_submission_uncertain', arguments: { ...identity,
            taskId: 1048, workItemId: 1699, leaseToken: 'offline-fixture-lease', attemptId: 1,
            idempotencyKey: 'offline-uncertain', reasonCode: '[VK_BROWSER_SUBMIT_UNCERTAIN]' } });
        assert.equal(malformed.isError, true);
    } finally {
        await client.close(); await server.close();
        if (previous === undefined) delete process.env.VK_CONNECTOR_DISPATCH_ENABLED;
        else process.env.VK_CONNECTOR_DISPATCH_ENABLED = previous;
    }
});
