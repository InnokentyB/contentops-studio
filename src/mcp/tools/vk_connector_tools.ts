import { ConnectorHostIdSchema } from '../../services/vk_connector_contract';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VkConnectorAppAuthority } from '../../services/vk_connector_app_authority';
import { VkConnectorExecutionService } from '../../services/vk_connector_execution.service';
import { createVkConnectorExecutionPorts } from '../../services/vk_connector_execution_ports';
import { VkConnectorDispatchService } from '../../services/vk_connector_dispatch.service';
import { vkConnectorRepository } from '../../services/vk_connector_repository';
import { loadAgentWorkspaceManifest } from '../../services/agent_workspace_manifest.service';
import { INTERNAL_MUTATION_ANNOTATIONS } from './common';
import { publicationDiagnosticResult } from './publication_diagnostic_result';
import { vkConnectorDiagnosticPayload, vkConnectorErrorDiagnostic, vkConnectorOutcomeDiagnostic } from '../../services/vk_connector_error_diagnostics';

const identity = { projectId: z.number().int().positive(), actorId: z.string() };
const host = { ...identity, hostId: ConnectorHostIdSchema };
const consumer = { ...host, instanceId: z.uuid() };
const job = { ...identity, jobId: z.uuid() };
const receipt = { ...consumer, jobId: z.uuid(), generation: z.number().int().nonnegative() };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const service = new VkConnectorDispatchService(vkConnectorRepository, process.env.VK_CONNECTOR_DISPATCH_ENABLED === '1');
const appAuthority = new VkConnectorAppAuthority(service, vkConnectorRepository);
const execution = new VkConnectorExecutionService(service, vkConnectorRepository, createVkConnectorExecutionPorts({
    admission: (args, purpose) => appAuthority.admission(args, purpose),
    verifyEvidence: (args, content, proof) => appAuthority.verifyEvidence(args, content, proof),
    verifyMediaAcknowledgement: (args, content) => appAuthority.verifyMediaAcknowledgement(args, content)
}));
async function safe(run: () => Promise<Record<string, unknown>>) {
    return publicationDiagnosticResult('vk', run, vkConnectorErrorDiagnostic, result => {
        const diagnostic = vkConnectorOutcomeDiagnostic(result);
        return { payload: diagnostic ? { ...vkConnectorDiagnosticPayload(result), diagnostics: diagnostic } : result,
            diagnostic, isError: false };
    });
}
async function manifest(projectId: number, actorId: string) {
    const match = /^user:([1-9]\d*)$/.exec(actorId);
    if (!match) throw new Error('[VK_CONNECTOR_AUTH_UNAVAILABLE]');
    return (await loadAgentWorkspaceManifest(projectId, Number(match[1]))).checksum;
}

/** Provider execution is not advertised: these tools only transport and inspect blocked tenant-owned jobs. */
export function registerVkConnectorTools(server: McpServer) {
    server.registerTool('ba_preview_vk_connector_dispatch', {
        description: 'Read exact immutable tenant-owned dispatch binding and current manifest. No VK operation.',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: { ...identity, taskId: z.number().int().positive() }
    }, args => safe(async () => ({ ...await service.preview(args), manifestChecksum: await manifest(args.projectId, args.actorId) })));
    server.registerTool('ba_get_vk_connector_health', {
        description: 'Read standalone registered consumer heartbeat. Online means infrastructure only; provider execution remains blocked.',
        annotations: { readOnlyHint: true, openWorldHint: false }, inputSchema: host
    }, args => safe(() => service.health(args)));
    server.registerTool('ba_get_vk_connector_job', {
        description: 'Read genuine consumer receipt/stage for a tenant-owned job. A queued work item is never publication.',
        annotations: { readOnlyHint: true, openWorldHint: false }, inputSchema: job
    }, args => safe(() => service.status(args)));
    if (process.env.VK_CONNECTOR_DISPATCH_ENABLED !== '1') return;
    const fenced = { ...receipt, packageSha256: hash };
    server.registerTool('ba_renew_vk_connector_heartbeat', { description: 'Renew the same authenticated host instance heartbeat without polling, claiming or changing any job.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: consumer
    }, args => safe(() => service.heartbeat(args)));
    server.registerTool('ba_rebind_vk_connector_reconciliation', { description: 'CAS rebind SAME uncertain job to current host instance for read-only reconciliation. Retains attempt/lease; never grants a send.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: fenced
    }, args => safe(() => service.rebindReconciliation(args)));
    server.registerTool('ba_issue_vk_connector_challenge', { description: 'Ephemeral120s managed application-host capability scoped to SAME job/hash/instance/generation/purpose. Not platform/tool-policy permission. No persisted credential.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...fenced, purpose: z.enum(['wall_read','submission','post_confirm']) }
    }, args => safe(() => appAuthority.issue(args)));
    const canonical = { ...fenced, taskId: z.number().int().positive(), channelId: z.number().int().positive(), workItemId: z.number().int().positive(),
        leaseToken: z.string().min(1).max(200), approvalReference: z.string().min(10).max(2048),
        idempotencyKey: z.string().min(1).max(200), contentRevision: z.number().int().positive(),
        textSha256: hash, imageSha256: hash, selectedAssetId: z.number().int().positive(), placement: z.enum(['feed','clip']) };
    server.registerTool('ba_resume_vk_connector_job', { description: 'Owner-only CAS resume of the SAME blocked job, unchanged package. Retains audit; no provider permission is granted.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...job, expectedGeneration: z.number().int().nonnegative(),
            expectedPackageSha256: hash, approvalReference: z.string().min(10).max(2048), idempotencyKey: z.string().min(1).max(160) }
    }, args => safe(() => service.resume(args)));
    server.registerTool('ba_get_vk_connector_execution_package', { description: 'Protected generation-bound accepted body/asset/release. Ephemeral content; permission NOT_CHECKED blocks provider execution.',
        annotations: { readOnlyHint: true, openWorldHint: false }, inputSchema: fenced
    }, args => safe(() => execution.package(args)));
    server.registerTool('ba_claim_vk_connector_execution', { description: 'Claim canonical lease only after trusted-source proven absence and verified permission. Caller evidence cannot grant permission.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...fenced, evidence: z.unknown() }
    }, args => safe(() => execution.claim(args)));
    server.registerTool('ba_reconcile_vk_connector_execution', { description: 'Trusted-source exact provider match records canonical fact without inventing a send attempt. Unknown source blocks.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...fenced, evidence: z.unknown() }
    }, args => safe(() => execution.reconcile(args)));
    server.registerTool('ba_check_vk_connector_execution', { description: 'Action-time generation/package/canonical-lease and permission check before every upload/submit.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...fenced, leaseToken: z.string().min(1).max(200) }
    }, args => safe(() => execution.check(args)));
    server.registerTool('ba_start_vk_connector_submission', { description: 'Atomically generation-fenced existing canonical durable attempt BEFORE provider upload. No provider call.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: canonical
    }, args => safe(() => execution.start(args)));
    server.registerTool('ba_confirm_vk_connector_submission', { description: 'Generation-fenced canonical fact commit, mandatory fresh provider timestamp/media acknowledgement from trusted capability.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...canonical, attemptId: z.number().int().positive(),
            publicUrl: z.string().url(), providerObjectId: z.string().regex(/^-[1-9]\d*_[1-9]\d*$/),
            publishedAt: z.iso.datetime(), evidenceSha256: hash, providerTimestampSource: z.literal('provider'),
            postBaselineCapturedAt: z.iso.datetime(), postBaselineObjectIds: z.array(z.string().regex(/^-[1-9]\d*_[1-9]\d*$/)).max(100),
            postSubmissionStartedAt: z.iso.datetime(), readbackObservedAt: z.iso.datetime(),
            providerAttestation: z.unknown().optional(), mediaAcknowledgement: z.object({ assetSha256: hash, providerMediaId: z.string().regex(/^photo-[1-9]\d*_[1-9]\d*$/),
                acknowledged: z.literal(true), providerObjectId: z.string().regex(/^-[1-9]\d*_[1-9]\d*$/) }).strict() }
    }, args => safe(() => execution.confirm(args)));
    server.registerTool('ba_mark_vk_connector_submission_uncertain', { description: 'Freeze a generation-bound started attempt after lost/uncertain provider result. Expired lease never permits resend.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...fenced, taskId: z.number().int().positive(), workItemId: z.number().int().positive(),
            leaseToken: z.string().min(1).max(200), attemptId: z.number().int().positive(), idempotencyKey: z.string().min(1).max(200),
            reasonCode: z.string().regex(/^[A-Z_]{1,100}$/) }
    }, args => safe(async () => {
        const result = await execution.uncertain(args);
        return { status: 'verification_required', result: result && typeof result === 'object' ? result : null };
    }));
    server.registerTool('ba_dispatch_vk_connector_job', {
        description: 'Queue exact owner-released package for standalone infrastructure-only consumer. Returns queued job; receipt is separate. Cannot publish to VK.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...identity, taskId: z.number().int().positive(), expectedPackageSha256: hash,
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/), idempotencyKey: z.string().min(1).max(160) }
    }, args => safe(async () => {
        if (await manifest(args.projectId, args.actorId) !== args.expectedManifestChecksum) throw new Error('[VK_CONNECTOR_STALE_MANIFEST]');
        return service.dispatch(args);
    }));
    server.registerTool('ba_poll_vk_connector_jobs', {
        description: 'Authenticated registered consumer heartbeat and bounded poll. Cannot open a profile or invoke a provider.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...consumer, buildVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/),
            mode: z.enum(['infrastructure_only','vk_feed_provider']).optional() }
    }, args => safe(() => service.poll(args)));
    server.registerTool('ba_ack_vk_connector_job', {
        description: 'Record actual package-verified consumer receipt with generation fencing. Does not claim provider execution.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...receipt, packageSha256: hash }
    }, args => safe(() => service.ack(args)));
    server.registerTool('ba_report_vk_connector_job', {
        description: 'Record infrastructure-only consumer blocker. No publication, attempt, lease reset or retry.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...receipt, blocker: z.enum(['PROVIDER_CONTROL_DENIED','PROVIDER_PERMISSION_UNVERIFIED','NOT_CONNECTED','LOGIN_REQUIRED','COVERAGE_UNKNOWN','MEDIA_UNCONFIRMED','ACTIVE_ATTEMPT','POLICY_DENIED']) }
    }, args => safe(async () => {
        const result = await service.report(args);
        if (args.blocker === 'POLICY_DENIED') appAuthority.revoke({ ...args, packageSha256: result.packageSha256 });
        return result;
    }));
    server.registerTool('ba_reconcile_vk_connector_job', {
        description: 'Project canonical existing fact/attempt into transport state. Provider inspection unavailable: reports control-denied/UNKNOWN, never absence or retry permission.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: job
    }, args => safe(() => service.reconcile(args)));
}
