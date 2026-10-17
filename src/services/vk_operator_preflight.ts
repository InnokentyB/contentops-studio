import { z } from 'zod';
import { ConnectorBindingSchema, ConnectorHostIdSchema, type ConnectorBinding } from './vk_connector_contract';
import { AUTHENTICATED_REMOTE_ACTOR, VkConnectorConfigSchema, vkConnectorPackageSha256, type VkConnectorControl, type VkConnectorConfig } from './vk_connector_consumer_runtime';
import { getVkConnectorRecordedRestriction, type VkConnectorRecordedRestriction } from './vk_connector_recorded_restriction';
import { inspectVkPreflightResources, type PreflightResources } from './vk_preflight_resources';
const Id = z.number().int().positive().safe(), Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const VkPreflightRequestSchema = z.object({ taskId: Id, jobId: z.uuid(), expectedPackageSha256: Hash }).strict();
export type VkPreflightRequest = z.infer<typeof VkPreflightRequestSchema>;
const Scope = VkPreflightRequestSchema.extend({ projectId: Id, actorId: z.union([z.string().regex(/^user:(?:0|[1-9]\d*)$/), z.literal(AUTHENTICATED_REMOTE_ACTOR)]), hostId: ConnectorHostIdSchema });
const Status = z.object({ jobId: z.uuid(), state: z.enum(['queued','accepted','blocked','verification_required','confirmed','reconciling','ready','executing','cancelled']),
    generation: z.number().int().nonnegative(), packageSha256: Hash, attemptId: Id.nullable(), factId: Id.nullable(), recordedRestrictions: z.unknown().optional() }).strip();
const Preview = z.object({ package: ConnectorBindingSchema, packageSha256: Hash }).strip();
const Resources = z.object({ profile: z.enum(['PASS','UNCONFIGURED','INVALID','UNAVAILABLE']), evidence: z.enum(['PASS','UNCONFIGURED','INVALID','UNAVAILABLE']),
    dependency: z.enum(['PASS','UNCONFIGURED','INVALID','UNAVAILABLE']) }).strict();
const Observation = z.object({ loggedIn: z.boolean(), communityAdmin: z.boolean(), communityId: z.number().int().negative().safe(),
    coverage: z.enum(['complete_window','partial']), objects: z.number().int().nonnegative().max(100), mediaSha256: Hash }).strip();
const READS = new Set(['ba_preview_vk_connector_dispatch','ba_get_vk_connector_job','ba_get_vk_connector_health']);
/** Immutable request scope plus a fixed read-only command list; no raw tool injection or default job. */
export function createVkPreflightReader(control: VkConnectorControl, rawScope: unknown): VkConnectorControl {
    const scope = Scope.parse(rawScope);
    return { close: () => control.close(), call: (name, args, signal) => {
        if (!READS.has(name)) throw new Error('[VK_PREFLIGHT_READ_ONLY]');
        const identity = { projectId: Id, actorId: z.string() };
        const parsed = name === 'ba_preview_vk_connector_dispatch' ? z.object({ ...identity, taskId: Id }).strict().parse(args)
            : name === 'ba_get_vk_connector_job' ? z.object({ ...identity, jobId: z.uuid() }).strict().parse(args)
            : z.object({ ...identity, hostId: ConnectorHostIdSchema }).strict().parse(args);
        if (parsed.projectId !== scope.projectId || parsed.actorId !== scope.actorId
            || ('taskId' in parsed && parsed.taskId !== scope.taskId) || ('jobId' in parsed && parsed.jobId !== scope.jobId)
            || ('hostId' in parsed && parsed.hostId !== scope.hostId)) throw new Error('[VK_PREFLIGHT_SCOPE_MISMATCH]');
        return control.call(name, parsed, signal);
    } };
}
export interface VkPreflightFixture { kind: 'offline_fixture'; inspect(signal: AbortSignal): Promise<unknown>; close(): Promise<void> }
export interface VkReadinessDiagnostics {
    controlPlane: 'NOT_CHECKED' | 'CONNECTED' | 'FAILED'; applicationAuthorization: 'NOT_ASSESSED'; providerReadiness: 'NOT_CHECKED';
    recordedRestriction: VkConnectorRecordedRestriction | null;
}
export interface VkPreflightResult {
    status: 'BLOCKED' | 'UNKNOWN' | 'OFFLINE_FIXTURE_CHECKED'; reason: string;
    scope: (VkPreflightRequest & { projectId: number; hostId: string }) | null; binding?: ConnectorBinding;
    productionReady: false; observedAt: string; generation?: number; packageSha256?: string; diagnostics: VkReadinessDiagnostics;
    resources?: PreflightResources; connection?: 'online' | 'offline'; objects?: number; quarantineRequired?: boolean;
}
async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error('[VK_PREFLIGHT_TIMEOUT]');
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new Error('[VK_PREFLIGHT_TIMEOUT]')); signal.addEventListener('abort', cancel, { once: true }); });
    try { return await Promise.race([Promise.resolve().then(operation), cancelled]); }
    finally { if (cancel) signal.removeEventListener('abort', cancel); }
}
/** Metadata/readiness only; neither fixture success nor an absent restriction grants provider authority. */
export async function runVkOperatorPreflight(rawConfig: unknown, control: VkConnectorControl, options: {
    request: VkPreflightRequest; resources?: (config: VkConnectorConfig) => PreflightResources; fixture?: VkPreflightFixture;
    signal?: AbortSignal; timeoutMs?: number; cleanupMs?: number;
}): Promise<VkPreflightResult> {
    const result: VkPreflightResult = { status: 'BLOCKED', reason: 'READINESS_SNAPSHOT_UNAVAILABLE', scope: null,
        productionReady: false, observedAt: new Date().toISOString(), diagnostics: { controlPlane: 'NOT_CHECKED',
            applicationAuthorization: 'NOT_ASSESSED', providerReadiness: 'NOT_CHECKED', recordedRestriction: null } };
    const timeout = options.timeoutMs ?? 120_000, cleanup = options.cleanupMs ?? 30_000;
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 120_000 || !Number.isInteger(cleanup) || cleanup < 10 || cleanup > 30_000)
        return { ...result, reason: 'INVALID_TIMEOUT' };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let fixtureStarted = false;
    try {
        const config = VkConnectorConfigSchema.parse(rawConfig), request = VkPreflightRequestSchema.parse(options.request);
        result.scope = { ...request, projectId: config.projectId, hostId: config.hostId };
        const reader = createVkPreflightReader(control, { ...result.scope, actorId: config.actorId ?? AUTHENTICATED_REMOTE_ACTOR });
        const identity = { projectId: config.projectId, actorId: config.actorId ?? AUTHENTICATED_REMOTE_ACTOR };
        const read = async (name: string, args: Record<string, unknown>) => {
            try { return await bounded(() => reader.call(name, args, signal), signal); }
            catch { result.diagnostics.controlPlane = 'FAILED'; throw new Error('[VK_PREFLIGHT_CONTROL_UNAVAILABLE]'); }
        };
        const preview = Preview.parse(await read('ba_preview_vk_connector_dispatch', { ...identity, taskId: request.taskId }));
        if (preview.package.projectId !== config.projectId || preview.package.taskId !== request.taskId
            || preview.packageSha256 !== request.expectedPackageSha256 || vkConnectorPackageSha256(preview.package) !== preview.packageSha256)
            throw new Error('[VK_PREFLIGHT_PACKAGE_CHANGED]');
        const validateJob = (raw: unknown) => {
            const job = Status.parse(raw);
            if (job.jobId !== request.jobId || job.packageSha256 !== preview.packageSha256) throw new Error('[VK_PREFLIGHT_JOB_SCOPE_MISMATCH]');
            return job;
        };
        const job = validateJob(await read('ba_get_vk_connector_job', { ...identity, jobId: request.jobId }));
        result.binding = preview.package; result.generation = job.generation; result.packageSha256 = job.packageSha256;
        result.diagnostics.recordedRestriction = getVkConnectorRecordedRestriction(preview.package, job.recordedRestrictions === undefined ? [] : job.recordedRestrictions, 'publication');
        const health = z.object({ hostId: ConnectorHostIdSchema, status: z.enum(['online','offline','disabled']), heartbeatAt: z.iso.datetime({ offset: true }).nullable() }).strip()
            .parse(await read('ba_get_vk_connector_health', { ...identity, hostId: config.hostId }));
        if (health.hostId !== config.hostId) throw new Error('[VK_PREFLIGHT_HOST_SCOPE_MISMATCH]');
        result.diagnostics.controlPlane = 'CONNECTED';
        const age = health.heartbeatAt ? Date.now() - Date.parse(health.heartbeatAt) : Infinity;
        result.connection = health.status === 'online' && age >= -1000 && age <= 30_000 ? 'online' : 'offline';
        result.resources = Resources.parse((options.resources ?? inspectVkPreflightResources)(config));
        result.reason = result.diagnostics.recordedRestriction ? 'RECORDED_EXTERNAL_RESTRICTION' : 'PROVIDER_NOT_CHECKED';
        if (job.attemptId !== null || ['executing','verification_required','reconciling'].includes(job.state)) result.reason = 'RECONCILIATION_REQUIRED';
        else if (job.factId !== null || job.state === 'confirmed') result.reason = 'EXISTING_RESULT';
        else if (result.connection !== 'online') result.reason = 'HOST_OFFLINE';
        else if (!result.diagnostics.recordedRestriction && options.fixture?.kind === 'offline_fixture' && Object.values(result.resources).every(value => value === 'PASS')) {
            fixtureStarted = true;
            const observed = Observation.parse(await bounded(() => options.fixture!.inspect(signal), signal));
            result.status = observed.loggedIn && observed.communityAdmin && observed.communityId === preview.package.communityId
                && observed.coverage === 'complete_window' && observed.mediaSha256 === preview.package.assetSha256 ? 'OFFLINE_FIXTURE_CHECKED' : 'UNKNOWN';
            result.reason = result.status === 'OFFLINE_FIXTURE_CHECKED' ? 'OFFLINE_ONLY_NOT_PROVIDER_READINESS' : 'FIXTURE_READINESS_UNCONFIRMED'; result.objects = observed.objects;
        }
        if (JSON.stringify(validateJob(await read('ba_get_vk_connector_job', { ...identity, jobId: request.jobId }))) !== JSON.stringify(job)) {
            result.status = 'BLOCKED'; result.reason = 'SNAPSHOT_CHANGED';
        }
    } catch (error: unknown) {
        const safe = error instanceof Error ? /^\[VK_PREFLIGHT_(PACKAGE_CHANGED|JOB_SCOPE_MISMATCH|HOST_SCOPE_MISMATCH|CONTROL_UNAVAILABLE)\]$/.exec(error.message)?.[1] : undefined;
        result.status = fixtureStarted ? 'UNKNOWN' : 'BLOCKED';
        result.reason = signal.aborted ? 'TIMEOUT_OR_CANCELLED' : fixtureStarted ? 'FIXTURE_READINESS_UNCONFIRMED' : safe ?? 'READINESS_SNAPSHOT_UNAVAILABLE';
    } finally {
        if (fixtureStarted && options.fixture) {
            const close = new AbortController(), closeTimer = setTimeout(() => close.abort(), cleanup);
            try { await bounded(() => options.fixture!.close(), close.signal); }
            catch { result.status = 'UNKNOWN'; result.reason = 'SESSION_CLEANUP_UNCONFIRMED'; result.quarantineRequired = true; }
            finally { clearTimeout(closeTimer); }
        }
        clearTimeout(timer);
    }
    return result;
}
