import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VkConnectorDispatchService } from '../../services/vk_connector_dispatch.service';
import { vkConnectorRepository } from '../../services/vk_connector_repository';
import { loadAgentWorkspaceManifest } from '../../services/agent_workspace_manifest.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

const identity = { projectId: z.literal(10), actorId: z.string() };
const host = { ...identity, hostId: z.literal('vk-connector-local-1048') };
const consumer = { ...host, instanceId: z.uuid() };
const job = { ...identity, jobId: z.uuid() };
const receipt = { ...consumer, jobId: z.uuid(), generation: z.number().int().nonnegative() };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const service = new VkConnectorDispatchService(vkConnectorRepository, process.env.VK_CONNECTOR_DISPATCH_ENABLED === '1');
async function safe(run: () => Promise<Record<string, unknown>>) {
    try { return asToolResult(await run()); }
    catch (error) {
        const candidate = error instanceof Error ? error.message.match(/^\[VK_CONNECTOR_[A-Z_]+\]/)?.[0] : null;
        return { ...asToolResult({ error: candidate || '[VK_CONNECTOR_REQUEST_FAILED]' }), isError: true };
    }
}
async function manifest(projectId: number, actorId: string) {
    const match = /^user:([1-9]\d*)$/.exec(actorId);
    if (!match) throw new Error('[VK_CONNECTOR_AUTH_UNAVAILABLE]');
    return (await loadAgentWorkspaceManifest(projectId, Number(match[1]))).checksum;
}

/** Provider execution is not advertised: these tools only transport and inspect blocked pilot jobs. */
export function registerVkConnectorTools(server: McpServer) {
    server.registerTool('ba_preview_vk_connector_dispatch', {
        description: 'Read exact immutable pilot1048 dispatch binding and current manifest. No VK operation.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: { ...identity, taskId: z.literal(1048) }
    }, args => safe(async () => ({ ...await service.preview(args), manifestChecksum: await manifest(args.projectId, args.actorId) })));
    server.registerTool('ba_get_vk_connector_health', {
        description: 'Read standalone pilot consumer heartbeat. Online means infrastructure only; provider execution remains blocked.',
        annotations: { readOnlyHint: true, openWorldHint: false }, inputSchema: host
    }, args => safe(() => service.health(args)));
    server.registerTool('ba_get_vk_connector_job', {
        description: 'Read genuine consumer receipt/stage for a pilot1048 job. A queued work item is never publication.',
        annotations: { readOnlyHint: true, openWorldHint: false }, inputSchema: job
    }, args => safe(() => service.status(args)));
    if (process.env.VK_CONNECTOR_DISPATCH_ENABLED !== '1') return;
    server.registerTool('ba_dispatch_vk_connector_job', {
        description: 'Queue exact owner-released1048 package for standalone infrastructure-only consumer. Returns queued job; receipt is separate. Cannot publish to VK.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...identity, taskId: z.literal(1048), expectedPackageSha256: hash,
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/), idempotencyKey: z.string().min(1).max(160) }
    }, args => safe(async () => {
        if (await manifest(args.projectId, args.actorId) !== args.expectedManifestChecksum) throw new Error('[VK_CONNECTOR_STALE_MANIFEST]');
        return service.dispatch(args);
    }));
    server.registerTool('ba_poll_vk_connector_jobs', {
        description: 'Authenticated pilot consumer heartbeat and bounded poll. Cannot open a profile or invoke a provider.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...consumer, buildVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/) }
    }, args => safe(() => service.poll(args)));
    server.registerTool('ba_ack_vk_connector_job', {
        description: 'Record actual package-verified consumer receipt with generation fencing. Does not claim provider execution.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...receipt, packageSha256: hash }
    }, args => safe(() => service.ack(args)));
    server.registerTool('ba_report_vk_connector_job', {
        description: 'Record infrastructure-only consumer blocker. No publication, attempt, lease reset or retry.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...receipt, blocker: z.literal('PROVIDER_CONTROL_DENIED') }
    }, args => safe(() => service.report(args)));
    server.registerTool('ba_reconcile_vk_connector_job', {
        description: 'Project canonical existing fact/attempt into transport state. Provider inspection unavailable: reports control-denied/UNKNOWN, never absence or retry permission.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: job
    }, args => safe(() => service.reconcile(args)));
}
