import type { Vk1048ApplicationBroker } from './vk1048_application_broker';
import type { Vk1048MediaSource } from './vk1048_wall_collector';
import type { Vk1048ProviderRuntime } from './vk1048_playwright_runtime';
import { validateVkPostConfirmation } from './vk_post_confirmation';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { VkBrowserUi, VkBrowserSubmissionControl, VkBrowserJob } from './vk_browser_worker.service';
import { VkConnectorPilotPackageSchema, vkConnectorPackageSha256, type VkConnectorControl, type VkConnectorIdentity } from './vk_connector_consumer_runtime';
import { evaluateVkConnectorReconciliation, type VkConnectorWallEvidence } from './vk_connector_reconciliation';

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const InputSchema = z.object({ identity: z.object({ projectId: z.literal(10), actorId: z.literal('user:0'),
    hostId: z.literal('vk-connector-local-1048'), instanceId: z.string().uuid(), buildVersion: z.string() }),
    jobId: z.string().uuid(), generation: z.number().int().positive(), packageSha256: Hash,
    binding: VkConnectorPilotPackageSchema }).strict();
const ExecutionSchema = z.object({ binding: VkConnectorPilotPackageSchema, packageSha256: Hash, body: z.string().min(1).max(20_000),
    asset: z.object({ id: z.literal(130), url: z.string().url(), sha256: Hash }), approvalReference: z.string().min(1),
    releasedAt: z.string().datetime({ offset: true }), lease: z.null(), permissionStatus: z.enum(['NOT_CHECKED', 'POLICY_DENIED', 'PERMITTED']),
    providerExecution: z.enum(['blocked', 'permitted']) }).strip();
const LeaseSchema = z.object({ workItemId: z.literal(1699), leaseToken: z.string().min(1), leaseExpiresAt: z.string().datetime({ offset: true }),
    generation: z.number().int().positive() }).strip();
const StartSchema = z.discriminatedUnion('status', [z.object({ status: z.literal('started'), attempt_id: z.number().int().positive() }),
    z.object({ status: z.literal('confirmed'), attempt_id: z.number().int().positive(), publication_fact_id: z.number().int().positive(), public_url: z.string().nullable() }),
    z.object({ status: z.literal('verification_required'), attempt_id: z.number().int().positive(), retry_allowed: z.literal(false) })]);
const CheckSchema = z.object({ status: z.literal('validated'), generation: z.number().int().positive() }).strip();
const ConfirmSchema = z.object({ publication_fact_id: z.number().int().positive() }).strip();
const ReconciledSchema = z.object({ factId: z.number().int().positive(), publicUrl: z.string().url() }).strip();
export interface Vk1048AdmissionPort {
    assess(): Promise<Vk1048ProviderResult | { status: 'OFFLINE_FIXTURE_ADMITTED'; executionContext: 'offline_fixture' } | { status: 'ACTION_ADMITTED'; executionContext: 'production_admitted' }>;
}
/** Current production factory has no action-time permission authority; no mutable configuration can override it. */
export const vk1048DefaultAdmission: Vk1048AdmissionPort = { assess: async () => vk1048ProductionAdmission() };

export interface Vk1048MediaAcknowledgement { assetSha256: string; providerMediaId: string; providerObjectId: string; acknowledged: true; source?: Vk1048MediaSource; }
export interface Vk1048ProviderSession {
    ui: VkBrowserUi;
    reconcile(binding: z.infer<typeof VkConnectorPilotPackageSchema>, body: string, releasedAt: string, signal?: AbortSignal): Promise<VkConnectorWallEvidence>;
    mediaAcknowledgement(signal?: AbortSignal): Promise<Vk1048MediaAcknowledgement | null>;
    /** Close only resources owned by this session so pending operations cannot continue after abort. */
    cancelPendingOperations(): Promise<void>;
}
/** Only in-process offline tests inject this harness. It is absent from config, jobs, MCP and production factories. */
export interface Vk1048OfflineHarness {
    executionContext: 'offline_fixture';
    evidenceDir: string;
    withSession<T>(run: (session: Vk1048ProviderSession) => Promise<T>): Promise<T>;
    loadApprovedImage(url: string): Promise<{ buffer: Buffer; filename: string; contentType?: string }>;
    now?: () => Date;
    /** Test-only shortened deadline; production jobs/configs cannot provide it. */
    operationTimeoutMs?: number;
    /** Trusted in-process test dependency, never deserialized from a job/config/MCP object. */
    admission?: Vk1048AdmissionPort;
}
export interface Vk1048ProviderResult {
    status: 'PERMISSION_UNVERIFIED' | 'verification_required' | 'offline_fixture_confirmed' | 'provider_confirmed';
    executionContext: 'production_blocked' | 'offline_fixture' | 'production_admitted';
    reason: string; generation?: number; factId?: number; publicUrl?: string | null;
    restriction?: { observedAt: string; affectedOperation: string; basis: string };
}
/** Production policy admission is unavailable. A config/environment/MCP payload cannot grant it. */
export function vk1048ProductionAdmission(): Vk1048ProviderResult {
    return { status: 'PERMISSION_UNVERIFIED', executionContext: 'production_blocked', reason: 'ACTION_TIME_ADMISSION_UNAVAILABLE',
        restriction: { observedAt: '2026-10-13', affectedOperation: 'Owned community https://vk.ru/club240051152 browser control',
            basis: 'Root cua.getTab site-safety denial prohibits direct access and indirect same-outcome execution through another browser or adapter; managed agent runtime remains blocked' } };
}
async function boundedProviderOperation<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number,
    outer?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    outer?.addEventListener('abort', abort, { once: true });
    if (outer?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    try {
        if (controller.signal.aborted) throw new Error('[VK1048_ABORTED]');
        const cancelled = new Promise<never>((_resolve, reject) => {
            stop = (): void => reject(new Error('[VK1048_OPERATION_TIMEOUT_OR_ABORT]'));
            controller.signal.addEventListener('abort', stop, { once: true });
            timer = setTimeout(abort, timeoutMs);
        });
        return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), cancelled]);
    } finally {
        if (timer) clearTimeout(timer);
        if (stop) controller.signal.removeEventListener('abort', stop);
        outer?.removeEventListener('abort', abort);
    }
}
function hash(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function confirmArgs(args: Record<string, unknown>): Record<string, unknown> {
    return { projectId: args.project_id, taskId: args.task_id, channelId: args.channel_id, actorId: 'user:0',
        workItemId: args.work_item_id, leaseToken: args.lease_token, approvalReference: args.approval_reference,
        contentRevision: args.content_revision, textSha256: args.text_sha256, imageSha256: args.image_sha256,
        selectedAssetId: args.selected_asset_id, placement: args.placement, idempotencyKey: args.idempotency_key,
        attemptId: args.attempt_id, publicUrl: args.public_url, providerObjectId: args.provider_object_id,
        publishedAt: args.published_at, evidenceSha256: args.evidence_sha256, providerTimestampSource: args.provider_timestamp_source,
        readbackObservedAt: args.readback_observed_at, postBaselineCapturedAt: args.post_baseline_captured_at,
        postBaselineObjectIds: args.post_baseline_object_ids, postSubmissionStartedAt: args.post_submission_started_at };
}
/** Fenced shim reuses the existing canonical browser submission path and refuses image-presence-only confirmation. */
export function createVk1048SubmissionControl(input: { identity: Omit<VkConnectorIdentity, 'mode'>; jobId: string; generation: number; packageSha256: string },
    binding: z.infer<typeof VkConnectorPilotPackageSchema>, control: VkConnectorControl, session: Vk1048ProviderSession,
    signal?: AbortSignal, now: () => Date = () => new Date(), budget = 30_000, broker?: Vk1048ApplicationBroker): VkBrowserSubmissionControl {
    const fenced = { projectId: input.identity.projectId, actorId: input.identity.actorId, hostId: input.identity.hostId,
        instanceId: input.identity.instanceId, jobId: input.jobId, generation: input.generation, packageSha256: input.packageSha256 };
    return { start: async (args) => StartSchema.parse(await control.call('ba_start_vk_connector_submission', { ...confirmArgs(args), ...fenced }, signal)),
        confirm: async (args) => {
            await validateVk1048ExecutionFence(input, control, String(args.lease_token ?? ''), signal);
            validateVkPostConfirmation(confirmArgs(args), String(binding.communityId), now());
            const ack = await boundedProviderOperation((inner) => session.mediaAcknowledgement(inner), budget, signal);
            if (!ack || !ack.acknowledged || ack.assetSha256 !== binding.assetSha256
                || ack.providerObjectId !== args.provider_object_id
                || !new RegExp(`^photo${binding.communityId}_[1-9]\\d*$`).test(ack.providerMediaId)) {
                throw new Error('[VK1048_MEDIA_UNCONFIRMED]');
            }
            const { source, ...canonicalAck } = ack;
            const canonical = confirmArgs(args);
            const proof = { providerObjectId: canonical.providerObjectId, publicUrl: canonical.publicUrl, publishedAt: canonical.publishedAt,
                evidenceSha256: canonical.evidenceSha256, providerTimestampSource: canonical.providerTimestampSource,
                postBaselineCapturedAt: canonical.postBaselineCapturedAt, postBaselineObjectIds: canonical.postBaselineObjectIds,
                postSubmissionStartedAt: canonical.postSubmissionStartedAt, readbackObservedAt: canonical.readbackObservedAt,
                mediaAcknowledgement: canonicalAck, ...(source ? { mediaSource: source } : {}) };
            return ConfirmSchema.parse(await control.call('ba_confirm_vk_connector_submission', { ...confirmArgs(args), ...fenced, mediaAcknowledgement: canonicalAck,
                ...(broker ? { providerAttestation: broker.attest('post_confirm', proof) } : {}) }, signal));
        }, markUncertain: async (args) => {
            await control.call('ba_mark_vk_connector_submission_uncertain', { ...confirmArgs(args), ...fenced,
                reasonCode: 'PROVIDER_VERIFICATION_REQUIRED' }, signal);
        } };
}
/** Recheck server-owned permission, immutable package, host generation and canonical lease before a mutation. */
export async function validateVk1048ExecutionFence(input: { identity: Omit<VkConnectorIdentity, 'mode'>; jobId: string; generation: number; packageSha256: string },
    control: VkConnectorControl, leaseToken: string, signal?: AbortSignal): Promise<void> {
    const result = CheckSchema.parse(await control.call('ba_check_vk_connector_execution', { projectId: input.identity.projectId, actorId: input.identity.actorId,
        hostId: input.identity.hostId, instanceId: input.identity.instanceId, jobId: input.jobId, generation: input.generation, packageSha256: input.packageSha256, leaseToken }, signal));
    if (result.generation !== input.generation) throw new Error('[VK1048_FENCE_UNCONFIRMED]');
}
function fencedWallUi(ui: VkBrowserUi, check: () => Promise<void>, budget: number, cancel: () => Promise<void>, signal?: AbortSignal, beforeReadback?: () => Promise<void>): VkBrowserUi {
    const step = async <T>(run: () => Promise<T>): Promise<T> => {
        try { return await boundedProviderOperation(run, budget, signal); }
        catch (error: unknown) { await boundedProviderOperation(cancel, budget); throw error; }
    };
    return { navigate: (url) => step(() => ui.navigate(url)), loginRequired: () => step(() => ui.loginRequired()),
        challengeRequired: ui.challengeRequired ? () => step(() => ui.challengeRequired!()) : undefined,
        capturePostBaseline: ui.capturePostBaseline ? () => step(() => ui.capturePostBaseline!()) : undefined,
        openWallComposer: () => step(() => ui.openWallComposer()), setPostText: (text) => step(() => ui.setPostText(text)),
        attachImage: async (file) => { await check(); await step(() => ui.attachImage(file)); },
        captureScreenshot: (file) => step(() => ui.captureScreenshot(file)),
        submitPost: ui.submitPost ? async () => { await check(); await step(() => ui.submitPost!()); } : undefined,
        readbackPost: ui.readbackPost ? async () => { await beforeReadback?.(); return step(() => ui.readbackPost!()); } : undefined };
}
/** Wire ordinary-image-feed worker behind immutable-package, reconciliation, lease and admission boundaries. */
export async function runVk1048ProviderJob(rawInput: unknown, control: VkConnectorControl,
    harness?: Vk1048OfflineHarness | Vk1048ProviderRuntime, signal?: AbortSignal): Promise<Vk1048ProviderResult> {
    // This gate precedes package download, UI lifecycle, profile access and every provider operation.
    const admission = await (harness?.admission ?? vk1048DefaultAdmission).assess();
    if (!harness || (harness.executionContext === 'offline_fixture' ? admission.status !== 'OFFLINE_FIXTURE_ADMITTED' : admission.status !== 'ACTION_ADMITTED'))
        return admission.status === 'PERMISSION_UNVERIFIED' || admission.status === 'verification_required' || admission.status === 'offline_fixture_confirmed' || admission.status === 'provider_confirmed' ? admission : vk1048ProductionAdmission();
    const executionContext = harness.executionContext;
    const confirmedStatus = executionContext === 'offline_fixture' ? 'offline_fixture_confirmed' as const : 'provider_confirmed' as const;
    const input = InputSchema.parse(rawInput);
    const budget = ('operationTimeoutMs' in harness ? harness.operationTimeoutMs : undefined) ?? 30_000;
    if (!Number.isInteger(budget) || budget < 10 || budget > 30_000) throw new Error('[VK1048_DEADLINE_INVALID]');
    const boundedControl: VkConnectorControl = { close: () => control.close(),
        call: (name, args, callerSignal) => boundedProviderOperation((inner) => control.call(name, args, inner), Math.min(budget, 15_000), callerSignal ?? signal) };
    let activeSession: Vk1048ProviderSession | undefined;
    if (vkConnectorPackageSha256(input.binding) !== input.packageSha256) {
        return { status: 'verification_required', executionContext, reason: 'PACKAGE_UNCONFIRMED' };
    }
    const fenced = { projectId: input.identity.projectId, actorId: input.identity.actorId, hostId: input.identity.hostId,
        instanceId: input.identity.instanceId, jobId: input.jobId, generation: input.generation, packageSha256: input.packageSha256 };
    const broker = 'broker' in harness ? harness.broker : undefined;
    try {
        if (broker) await broker.authorize('wall_read', signal);
        const execution = ExecutionSchema.parse(await boundedControl.call('ba_get_vk_connector_execution_package', fenced, signal));
        if (execution.packageSha256 !== input.packageSha256 || vkConnectorPackageSha256(execution.binding) !== input.packageSha256
            || execution.asset.sha256 !== input.binding.assetSha256 || hash(execution.body.trim()) !== input.binding.bodySha256) {
            throw new Error('[VK1048_PACKAGE_UNCONFIRMED]');
        }
        if (execution.permissionStatus !== 'PERMITTED' || execution.providerExecution !== 'permitted') {
            return { status: 'verification_required', executionContext, reason: 'PERMISSION_UNVERIFIED' };
        }
        const image = await boundedProviderOperation(() => harness.loadApprovedImage(execution.asset.url), budget, signal);
        if (hash(image.buffer) !== input.binding.assetSha256) throw new Error('[VK1048_ASSET_UNCONFIRMED]');
        return await harness.withSession(async (session) => {
            activeSession = session;
            const evidence = await boundedProviderOperation((inner) => session.reconcile(input.binding, execution.body, execution.releasedAt, inner), Math.min(120_000, ('operationTimeoutMs' in harness ? harness.operationTimeoutMs : undefined) ?? 120_000), signal);
            const providerAttestation = broker?.attest('wall_read', evidence);
            const decision = evaluateVkConnectorReconciliation(input.binding, execution.body, execution.releasedAt, evidence,
                (harness.now ?? (() => new Date()))());
            if (decision.kind === 'unknown') return { status: 'verification_required', executionContext, reason: decision.reason };
            if (decision.kind === 'exact_match') {
                const confirmed = ReconciledSchema.parse(await boundedControl.call('ba_reconcile_vk_connector_execution', { ...fenced, evidence: providerAttestation ?? evidence }, signal));
                return { status: confirmedStatus, executionContext, reason: 'EXACT_EXISTING_OBJECT', ...confirmed };
            }
            if ('reconcileOnly' in harness && harness.reconcileOnly) return { status: 'verification_required', executionContext, reason: 'RECONCILIATION_ONLY' };
            const lease = LeaseSchema.parse(await boundedControl.call('ba_claim_vk_connector_execution', { ...fenced, evidence: providerAttestation ?? evidence }, signal));
            if (lease.generation <= input.generation || Date.parse(lease.leaseExpiresAt) <= (harness.now ?? (() => new Date()))().getTime()) {
                throw new Error('[VK1048_LEASE_UNCONFIRMED]');
            }
            if (broker) { broker.updateGeneration(lease.generation); await broker.authorize('submission', signal); }
            const job: VkBrowserJob = { schema_version: 1, job_id: input.jobId, project_id: 10, task_id: 1048, channel_id: 117,
                idempotency_key: `connector:${input.jobId}:${input.packageSha256}`, target: { community_url: 'https://vk.com/club240051152', community_id: -240051152, placement: 'wall_post' },
                payload: { text: execution.body, media_url: execution.asset.url }, approval: { content_revision: 1, accepted_revision: 1,
                    text_state: 'accepted', visual_state: 'APPROVED', selected_asset_id: 130 }, execution: { mode: 'submit', authorization: {
                    work_item_id: lease.workItemId, lease_token: lease.leaseToken, approval_reference: execution.approvalReference,
                    attempt_idempotency_key: `connector:${input.jobId}:${input.packageSha256}` } } };
            const { submitVkBrowserPublication } = await import('./vk_browser_worker.service');
            const executionIdentity = { ...input, generation: lease.generation };
            const ui = fencedWallUi(session.ui, () => validateVk1048ExecutionFence(executionIdentity, boundedControl, lease.leaseToken, signal), budget, () => session.cancelPendingOperations(), signal, broker ? () => broker.authorize('post_confirm', signal) : undefined);
            const result = await submitVkBrowserPublication(job, { ui, approvedAssetRoots: [], evidenceDir: harness.evidenceDir,
                now: harness.now, loadRemoteImage: async () => image,
                control: createVk1048SubmissionControl({ ...input, generation: lease.generation }, input.binding, boundedControl, session, signal, harness.now, budget, broker) });
            return { status: confirmedStatus, executionContext, reason: 'EXACT_NEW_OBJECT', generation: lease.generation,
                factId: result.publication_fact_id, publicUrl: result.public_url };
        });
    } catch {
        if (activeSession) {
            try { await boundedProviderOperation(() => activeSession!.cancelPendingOperations(), budget); }
            catch { return { status: 'verification_required', executionContext, reason: 'SESSION_CLEANUP_UNCONFIRMED' }; }
        }
        return { status: 'verification_required', executionContext, reason: 'EXECUTION_UNCONFIRMED' };
    }
}
