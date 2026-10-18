import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerVkConnectorTools } from '../mcp/tools/vk_connector_tools';
import { VkConnectorDispatchService } from '../services/vk_connector_dispatch.service';

const guards = ['AUTH_UNAVAILABLE','SCOPE_MISMATCH','HOST_IDENTITY_INVALID','DISABLED','STALE_MANIFEST',
    'PACKAGE_CHANGED','PACKAGE_NOT_READY','IDEMPOTENCY_CONFLICT','ALREADY_PUBLISHED','VERIFICATION_REQUIRED',
    'FENCED','CAS_CONFLICT','JOB_NOT_FOUND','EXECUTION_PACKAGE_UNAVAILABLE','ATTEMPT_CHANGED','INPUT_INVALID',
    'BUILD_INVALID','HOST_BUSY','BLOCKER_INVALID','PROVIDER_MODE_REQUIRED','RECONCILIATION_SOURCE_UNVERIFIED',
    'HOST_MODE_INVALID','LEASE_UNAVAILABLE','MEDIA_UNCONFIRMED','MEDIA_SOURCE_UNVERIFIED','RECONCILIATION_ONLY','CHALLENGE_CAPACITY'];

test('VK real MCP boundary serializes each guard safely and preserves returned state', async () => {
    const original = VkConnectorDispatchService.prototype.health;
    let outcome: unknown; let returned = false;
    VkConnectorDispatchService.prototype.health = async () => {
        if (!returned) throw outcome;
        return outcome as Awaited<ReturnType<typeof original>>;
    };
    const logs: string[] = []; const warn = console.warn; console.warn = value => { logs.push(String(value)); };
    const server = new McpServer({ name: 'synthetic-vk', version: '1' }); registerVkConnectorTools(server);
    const client = new Client({ name: 'fixture', version: '1' }); const [a, b] = InMemoryTransport.createLinkedPair();
    const call = () => client.callTool({ name: 'ba_get_vk_connector_health', arguments: {
        projectId: 10, actorId: 'user:2', hostId: 'vk-connector-local-1048' } });
    try {
        await server.connect(a); await client.connect(b);
        for (const code of [...guards, 'SECRET_TOKEN']) {
            outcome = new Error(`[VK_CONNECTOR_${code}] secret approval cookie body token`);
            const reply = await call(); const payload = reply.structuredContent as Record<string, unknown>;
            assert.equal(reply.isError, true);
            assert.equal(payload.code, `VK_CONNECTOR_${code === 'SECRET_TOKEN' ? 'REQUEST_FAILED' : code}`);
            assert.equal(payload.retry_allowed, false);
            assert.ok(Array.isArray(payload.reasons) && payload.reasons.length === 1);
            assert.doesNotMatch(JSON.stringify([reply, logs]), /secret approval|cookie body|SECRET_TOKEN/);
        }
        assert.equal(logs.length, guards.length + 1);
        returned = true;
        for (const blocker of ['PROVIDER_CONTROL_DENIED','POLICY_DENIED','LOGIN_REQUIRED','COVERAGE_UNKNOWN',
            'PROVIDER_PERMISSION_UNVERIFIED','ACTIVE_ATTEMPT','EXECUTION_INTERRUPTED','CANONICAL_LEASE_UNAVAILABLE',
            'NOT_CONNECTED','MEDIA_UNCONFIRMED','PROVIDER_VERIFICATION_REQUIRED','RECONCILIATION_ONLY','PACKAGE_NOT_READY']) {
            outcome = { state: 'verification_required', blocker };
            const reply = await call(); const payload = reply.structuredContent as Record<string, unknown>;
            assert.equal(reply.isError, false); assert.equal(payload.state, 'verification_required');
            assert.equal(payload.blocker, blocker); assert.match(JSON.stringify(payload.diagnostics), /reconcil/i);
        }
        for (const status of ['offline', 'disabled']) {
            outcome = { status, providerExecution: 'blocked' };
            const reply = await call(); const payload = reply.structuredContent as Record<string, unknown>;
            assert.equal(reply.isError, false); assert.ok(payload.diagnostics);
        }
        outcome = { state: 'blocked', blocker: 'secret-raw-blocker', error: 'secret-provider-payload',
            body: 'secret-body', approvalReference: 'secret-approval' };
        const redacted = await call();
        assert.doesNotMatch(JSON.stringify([redacted, logs]), /secret-raw|secret-provider|secret-body|secret-approval/);
        outcome = { status: 'verification_required', result: { body: 'nested-raw-payload' } };
        const uncertain = await call();
        assert.equal(uncertain.isError, false);
        assert.match(JSON.stringify(uncertain.structuredContent), /Reconcile/);
        assert.doesNotMatch(JSON.stringify(uncertain), /nested-raw-payload/);
        outcome = { state: 'blocked', blocker: 'POLICY_DENIED', health: { status: 'online' } };
        const outer = await call();
        assert.equal((outer.structuredContent as Record<string, unknown>).code, 'VK_CONNECTOR_POLICY_DENIED');
        for (const permissionStatus of ['POLICY_DENIED', 'NOT_CHECKED']) {
            outcome = { body: 'authorized-private-content', permissionStatus, providerExecution: 'blocked', lease: null, error: 'package-secret-extra' };
            const content = await call(); const payload = content.structuredContent as Record<string, unknown>;
            assert.equal(content.isError, false); assert.equal(payload.body, 'authorized-private-content');
            assert.doesNotMatch(JSON.stringify(content), /package-secret-extra/);
            assert.equal(payload.code, permissionStatus === 'POLICY_DENIED' ? 'VK_CONNECTOR_POLICY_DENIED' : 'VK_CONNECTOR_PROVIDER_PERMISSION_UNVERIFIED');
            assert.doesNotMatch(JSON.stringify(logs), /authorized-private-content/);
        }
        outcome = { state: 'published', blocker: null };
        assert.deepEqual((await call()).structuredContent, outcome);
        assert.equal(logs.length, guards.length + 21);
    } finally { console.warn = warn; VkConnectorDispatchService.prototype.health = original; await client.close(); await server.close(); }
});
