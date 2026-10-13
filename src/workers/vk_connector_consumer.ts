import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { acquireVkConnectorLock, consumeVkConnectorOnce, loadVkConnectorConfig, readVkConnectorToken, writeVkConnectorHealth,
    type VkConnectorConfig, type VkConnectorControl, type VkConnectorCycleResult, type VkConnectorProviderDispatch } from '../services/vk_connector_consumer_runtime';

const ToolResponseSchema = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).passthrough();
/** MCP wire decoding strips raw error messages and validates unknown response objects. */
export function parseVkConnectorToolResponse(raw: unknown): unknown {
    const response = ToolResponseSchema.parse(raw);
    if (response.isError) throw new Error('[VK_CONNECTOR_MCP_CALL_REJECTED]');
    if (response.structuredContent !== undefined) return response.structuredContent;
    const block = response.content?.find((item) => item.type === 'text');
    if (!block?.text) throw new Error('[VK_CONNECTOR_MCP_RESPONSE_INVALID]');
    try { return JSON.parse(block.text); }
    catch { throw new Error('[VK_CONNECTOR_MCP_RESPONSE_INVALID]'); }
}
async function connect(config: VkConnectorConfig, token: string, signal: AbortSignal): Promise<VkConnectorControl> {
    const client = new Client({ name: 'contentops-vk-infrastructure-consumer', version: config.buildVersion });
    const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' }
    });
    try {
        await client.connect(transport, { signal, timeout: 15_000 });
    } catch {
        await client.close();
        throw new Error('[VK_CONNECTOR_AUTH_OR_CONTROL_UNAVAILABLE]');
    }
    return { async call(name, args, callerSignal): Promise<unknown> {
        return parseVkConnectorToolResponse(await client.callTool({ name, arguments: args }, undefined,
            { signal: callerSignal, timeout: 15_000 }));
    }, close: () => client.close() };
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
    });
}
/** Standalone outbound loop; prepared provider mode remains permission-unverified before browser or profile access. */
export async function runVkConnectorConsumer(configFile: string, signal: AbortSignal,
    connector: (config: VkConnectorConfig, token: string, signal: AbortSignal) => Promise<VkConnectorControl> = connect,
    operatorRuntimeFactory?: (config: VkConnectorConfig) => VkConnectorProviderDispatch): Promise<void> {
    const config = loadVkConnectorConfig(configFile);
    const token = readVkConnectorToken(config);
    const lock = acquireVkConnectorLock(config);
    let control: VkConnectorControl | undefined;
    let backoff = 5000; let preserveLock = false;
    const dispatch = operatorRuntimeFactory?.(config);
    try {
        while (!signal.aborted) {
            let latest: VkConnectorCycleResult | undefined;
            try {
                control ??= await connector(config, token, signal);
                const result = await consumeVkConnectorOnce({ projectId: 10, actorId: 'user:0', hostId: config.hostId,
                    instanceId: lock.instanceId, buildVersion: config.buildVersion, mode: config.mode }, control, signal, 15_000, undefined, dispatch);
                latest = result;
                writeVkConnectorHealth(config, lock.instanceId, result);
                if (result.status === 'auth_or_control_unavailable') throw new Error('[VK_CONNECTOR_CONTROL_UNAVAILABLE]');
                backoff = 5000;
                if (operatorRuntimeFactory && ['provider_confirmed', 'provider_verification_required'].includes(result.status)) {
                    preserveLock = result.providerReason === 'SESSION_CLEANUP_UNCONFIRMED'; break;
                }
            } catch {
                if (control) { await control.close(); control = undefined; }
                writeVkConnectorHealth(config, lock.instanceId, latest ?? { status: 'auth_or_control_unavailable', mode: config.mode,
                    providerExecution: 'blocked', blocker: config.mode === 'vk_feed_provider' ? 'PROVIDER_PERMISSION_UNVERIFIED' : 'PROVIDER_CONTROL_DENIED', receipts: [], heartbeatAt: null });
                backoff = Math.min(60_000, backoff * 2);
            }
            await wait(backoff, signal);
        }
    } finally {
        try { await control?.close(); }
        finally { if (!preserveLock) lock.release(); }
    }
}
/** Explicit one-shot human recovery; never used by the managed polling entry. */
export async function runVkConnectorOperatorReconcile(configFile: string, signal: AbortSignal): Promise<void> {
    const config = loadVkConnectorConfig(configFile); const token = readVkConnectorToken(config); const lock = acquireVkConnectorLock(config);
    let control: VkConnectorControl | undefined; let preserveLock = false;
    try {
        control = await connect(config, token, signal);
        const { runVk1048OperatorReconcile } = await import('../services/vk1048_operator_reconcile');
        const result = await runVk1048OperatorReconcile(config, { projectId: 10, actorId: 'user:0', hostId: config.hostId,
            instanceId: lock.instanceId, buildVersion: config.buildVersion, mode: 'vk_feed_provider' }, control, signal);
        preserveLock = result.reason === 'SESSION_CLEANUP_UNCONFIRMED';
        process.stdout.write(`${result.status}: ${result.reason}\n`);
    } finally { try { await control?.close(); } finally { if (!preserveLock) lock.release(); } }
}
if (require.main === module) {
    const abort = new AbortController();
    process.once('SIGTERM', () => abort.abort());
    process.once('SIGINT', () => abort.abort());
    const operator = process.argv[2] === '--operator-run';
    const reconcile = process.argv[2] === '--operator-reconcile';
    const file = process.argv[operator || reconcile ? 3 : 2] ?? '';
    const run = async () => {
        if (reconcile) return runVkConnectorOperatorReconcile(file, abort.signal);
        if (!operator) return runVkConnectorConsumer(file, abort.signal);
        const { createVk1048OperatorDispatch } = await import('../services/vk1048_operator_dispatch');
        return runVkConnectorConsumer(file, abort.signal, connect, createVk1048OperatorDispatch);
    };
    run().catch((error: unknown) => {
        const allowed = new Set(['[VK_CONNECTOR_AUTH_UNAVAILABLE]', '[VK_CONNECTOR_ALREADY_RUNNING_OR_STALE_LOCK]',
            '[VK_CONNECTOR_PRIVATE_FILE_REQUIRED]', '[VK_CONNECTOR_PRIVATE_DIRECTORY_REQUIRED]', '[VK_CONNECTOR_LOCK_INITIALIZATION_FAILED]']);
        const candidate = error instanceof Error ? error.message.match(/^\[[A-Z0-9_]+\]/)?.[0] : undefined;
        const code = candidate && allowed.has(candidate) ? candidate : '[VK_CONNECTOR_STOPPED]';
        process.stderr.write(`${code} Private configuration/auth/control/lock unavailable; provider execution remains blocked.\n`);
        process.exitCode = 1;
    });
}
