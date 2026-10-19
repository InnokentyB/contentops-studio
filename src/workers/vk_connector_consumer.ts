import { VkPreflightRequestSchema, type VkPreflightRequest } from '../services/vk_operator_preflight';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { AUTHENTICATED_REMOTE_ACTOR, acquireVkConnectorLock, consumeVkConnectorOnce, loadVkConnectorConfig, readVkConnectorToken, writeVkConnectorHealth,
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
    const dispatch: VkConnectorProviderDispatch | undefined = operatorRuntimeFactory
        ? (input, activeControl, activeSignal) => operatorRuntimeFactory(config)(input, activeControl, activeSignal) : undefined;
    try {
        while (!signal.aborted) {
            let latest: VkConnectorCycleResult | undefined;
            try {
                control ??= await connector(config, token, signal);
                const result = await consumeVkConnectorOnce({ projectId: config.projectId, actorId: config.actorId ?? AUTHENTICATED_REMOTE_ACTOR, hostId: config.hostId,
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
/** Preflight owns its client before waiting for connection: even a stuck handshake can be cleaned up. */
async function connectPreflight(config: VkConnectorConfig, token: string, signal: AbortSignal): Promise<VkConnectorControl> {
    const client = new Client({ name: 'contentops-vk-readiness-consumer', version: config.buildVersion });
    const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' }
    });
    const connected = client.connect(transport, { signal, timeout: 15000 }).then(
        () => true, () => false); // Read calls report the fixed connection failure; no raw SDK error is exposed.
    return { async call(name, args, callerSignal) {
        if (!await connected) throw new Error('[VK_CONNECTOR_AUTH_OR_CONTROL_UNAVAILABLE]');
        return parseVkConnectorToolResponse(await client.callTool({ name, arguments: args }, undefined,
            { signal: callerSignal, timeout: 15000 }));
    }, close: () => client.close() };
}
/** Readiness only: no polling, lock acquisition, provider dispatch or canonical mutation. */
export async function runVkConnectorOperatorPreflight(configFile: string, request: VkPreflightRequest, signal: AbortSignal,
    connector: (config: VkConnectorConfig, token: string, signal: AbortSignal) => Promise<VkConnectorControl> = connectPreflight): Promise<void> {
    const config = loadVkConnectorConfig(configFile);
    const selected = VkPreflightRequestSchema.parse(request);
    const token = readVkConnectorToken(config);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 120000);
    const active = AbortSignal.any([signal, deadline.signal]);
    let control: VkConnectorControl | undefined;
    let result: import('../services/vk_operator_preflight').VkPreflightResult | undefined;
    let closeFailed = false;
    try {
        control = await connector(config, token, active);
        const { runVkOperatorPreflight } = await import('../services/vk_operator_preflight');
        result = await runVkOperatorPreflight(config, control, { request: selected, signal: active });
    } finally {
        deadline.abort();
        if (control) {
            let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([Promise.resolve().then(() => control!.close()), new Promise<never>((_resolve, reject) => {
                    cleanupTimer = setTimeout(() => reject(new Error('[VK_CONTROL_CLEANUP_UNCONFIRMED]')), 30000);
                })]);
            } catch { closeFailed = true; } // Report the unknown cleanup outcome below, never retry or release another process lock.
            finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
        }
        clearTimeout(timer);
    }
    if (result) {
        if (closeFailed) { result.status = 'UNKNOWN'; result.reason = 'CONTROL_CLEANUP_UNCONFIRMED'; result.quarantineRequired = true; }
        process.stdout.write(`${JSON.stringify(result)}\n`);
    }
}
/** Explicit one-shot human recovery; never used by the managed polling entry. */
export async function runVkConnectorOperatorReconcile(configFile: string, jobId: string, signal: AbortSignal): Promise<void> {
    const config = loadVkConnectorConfig(configFile); const token = readVkConnectorToken(config); const lock = acquireVkConnectorLock(config);
    let control: VkConnectorControl | undefined; let preserveLock = false;
    try {
        control = await connect(config, token, signal);
        const { runVkConnectorOperatorReconcile: reconcileJob } = await import('../services/vk_connector_operator_reconcile');
        const result = await reconcileJob(config, { projectId: config.projectId, actorId: config.actorId ?? AUTHENTICATED_REMOTE_ACTOR, hostId: config.hostId,
            instanceId: lock.instanceId, buildVersion: config.buildVersion, mode: 'vk_feed_provider' }, control, z.uuid().parse(jobId), signal);
        preserveLock = result.reason === 'SESSION_CLEANUP_UNCONFIRMED';
        process.stdout.write(`${result.status}: ${result.reason}\n`);
    } finally { try { await control?.close(); } finally { if (!preserveLock) lock.release(); } }
}
if (require.main === module) {
    const abort = new AbortController();
    process.once('SIGTERM', () => abort.abort());
    process.once('SIGINT', () => abort.abort());
    const preflight = process.argv[2] === '--operator-preflight';
    const operator = process.argv[2] === '--operator-run';
    const reconcile = process.argv[2] === '--operator-reconcile';
    const file = process.argv[operator || reconcile || preflight ? 3 : 2] ?? '';
    const run = async () => {
        if (preflight) return runVkConnectorOperatorPreflight(file, VkPreflightRequestSchema.parse({
            taskId: Number(process.argv[4]), jobId: process.argv[5], expectedPackageSha256: process.argv[6] }), abort.signal);
        if (reconcile) return runVkConnectorOperatorReconcile(file, z.uuid().parse(process.argv[4]), abort.signal);
        if (!operator) return runVkConnectorConsumer(file, abort.signal);
        const { createVkConnectorOperatorDispatch } = await import('../services/vk_connector_operator_dispatch');
        return runVkConnectorConsumer(file, abort.signal, connect, createVkConnectorOperatorDispatch);
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
