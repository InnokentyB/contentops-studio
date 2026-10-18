import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTaskPublicationTools } from '../mcp/tools/task_publication_tools';
import mcpPublicationService from '../services/mcp_publication.service';
import telegramTaskPublicationService from '../services/telegram_task_publication.service';
import threadsTaskPublicationService from '../services/threads_task_publication.service';

async function withClient(run: (client: Client) => Promise<void>) {
    const server = new McpServer({ name: 'publication-diagnostic-acceptance', version: '1' });
    registerTaskPublicationTools(server);
    const client = new Client({ name: 'operator', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try { await server.connect(a); await client.connect(b); await run(client); }
    finally { await client.close(); await server.close(); }
}

for (const code of ['ACCEPTED_REVISION_REQUIRED', 'PUBLICATION_ATTEMPT_UNCERTAIN']) {
    test(`canonical task MCP explains ${code} with no raw provider error`, async t => {
        const logs: unknown[][] = [];
        t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args); });
        t.mock.method(threadsTaskPublicationService, 'isThreadsTask', async () => false);
        let calls = 0;
        t.mock.method(telegramTaskPublicationService, 'execute', async () => {
            calls += 1; throw new Error(`[${code}] private-provider-payload`);
        });
        await withClient(async client => {
            const result = await client.callTool({ name: 'ba_publish_publication_task',
                arguments: { projectId: 20, taskId: 5000, dryRun: true } });
            assert.equal(result.isError, true);
            const payload = result.structuredContent as Record<string, unknown>;
            assert.equal(payload.code, code); assert.equal(payload.retry_allowed, false);
            assert.ok(Array.isArray(payload.reasons));
            assert.match(JSON.stringify(payload.reasons), /action/);
            if (code === 'PUBLICATION_ATTEMPT_UNCERTAIN') assert.match(JSON.stringify(payload.reasons), /[Rr]econcile/);
            assert.ok(!JSON.stringify({ result, logs }).includes('private-provider-payload'));
            assert.equal(logs.length, 1); assert.equal(calls, 1);
        });
    });
}

test('direct MCP explains adapter requirement, removes raw failed-result extras and never retries', async t => {
    const logs: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args); });
    let calls = 0;
    t.mock.method(mcpPublicationService, 'publishDirect', async () => {
        calls += 1; return { success: false, blocked: true, reason: 'vk_adapter_required',
            error: 'private-token', body: 'private-body', provider_execution: 'blocked' };
    });
    await withClient(async client => {
        const result = await client.callTool({ name: 'ba_publish_direct', arguments: {
            projectId: 20, channelType: 'vk', text: 'private-body', dryRun: true
        } });
        const payload = result.structuredContent as Record<string, unknown>;
        assert.equal(result.isError, true); assert.equal(payload.reason, 'vk_adapter_required');
        assert.equal(payload.code, 'VK_INDEPENDENT_ADAPTER_REQUIRED');
        assert.equal(payload.retry_allowed, false);
        assert.ok(!JSON.stringify({ result, logs }).includes('private-'));
        assert.equal(calls, 1); assert.equal(logs.length, 1);
    });
});

test('direct MCP unexpected error has safe investigation path and does not echo raw trace', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(mcpPublicationService, 'publishDirect', async () => {
        throw Object.assign(new Error('private-token private-body'), { routeTrace: {
            eligibility: { mtproto: false, reason: 'private-token', reason_code: 'project_session_missing' },
            final_adapter: 'bot_api', fallback_reason: 'private-body', target: { value: 'private-destination' }
        } });
    });
    await withClient(async client => {
        const result = await client.callTool({ name: 'ba_publish_direct', arguments: {
            projectId: 20, channelType: 'telegram', text: 'private-body', dryRun: true
        } });
        const payload = result.structuredContent as Record<string, unknown>;
        assert.equal(result.isError, true); assert.equal(payload.code, 'PUBLICATION_REQUEST_FAILED');
        assert.ok(payload.route_trace); assert.ok(Array.isArray(payload.reasons));
        assert.ok(!JSON.stringify(result).includes('private-'));
    });
});
