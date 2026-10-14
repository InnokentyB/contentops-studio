import { z } from 'zod';
import { VK_CONNECTOR_SCOPE } from './vk_connector_contract';
import { VkConnectorConfigSchema, VkConnectorPilotPackageSchema, vkConnectorPackageSha256,
    type VkConnectorControl, type VkConnectorConfig } from './vk_connector_consumer_runtime';
import { vk1048ProductionAdmission } from './vk1048_provider_execution';
import { inspectVk1048PreflightResources, type PreflightResources } from './vk1048_preflight_resources';
const JOB = '3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de';
const PACKAGE = '00636df473f9fae9f7dee61a3c358d5c64e3f28b8e856aed8374c1302bc2aaea';
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Status = z.object({ jobId: z.literal(JOB), state: z.enum(['queued','accepted','blocked','verification_required','confirmed','reconciling','ready','executing','cancelled']), generation: z.number().int().nonnegative(),
    packageSha256: Hash, attemptId: z.number().int().nullable(), factId: z.number().int().nullable() }).strip();
const Preview = z.object({ package: VkConnectorPilotPackageSchema, packageSha256: Hash }).strip();
const Observation = z.object({ loggedIn: z.boolean(), communityAdmin: z.boolean(), communityId: z.number().int(),
    coverage: z.enum(['complete_window', 'partial']), objects: z.number().int().nonnegative().max(100), mediaSha256: Hash }).strip();
const Resources = z.object({ profile: z.enum(['PASS','UNCONFIGURED','INVALID','UNAVAILABLE']),
    evidence: z.enum(['PASS','UNCONFIGURED','INVALID','UNAVAILABLE']), dependency: z.enum(['PASS','UNCONFIGURED','INVALID','UNAVAILABLE']) }).strip();
const READS = new Set(['ba_preview_vk_connector_dispatch', 'ba_get_vk_connector_job', 'ba_get_vk_connector_health']);
/** No execution authority, mutation, poll, challenge issuance or job reassignment is exposed. */
export function createVk1048PreflightReader(control: VkConnectorControl): VkConnectorControl {
    return { close: () => control.close(), call: (name, args, signal) => {
        if (!READS.has(name)) throw new Error('[VK1048_PREFLIGHT_READ_ONLY]');
        const shape = { projectId: z.literal(10), actorId: z.literal('user:0') };
        if (name === 'ba_preview_vk_connector_dispatch') z.object({ ...shape, taskId: z.literal(1048) }).strict().parse(args);
        else if (name === 'ba_get_vk_connector_job') z.object({ ...shape, jobId: z.literal(JOB) }).strict().parse(args);
        else z.object({ ...shape, hostId: z.literal('vk-connector-local-1048') }).strict().parse(args);
        return control.call(name, args, signal);
    } };
}
export interface Vk1048PreflightFixture {
    kind: 'offline_fixture'; inspect(signal: AbortSignal): Promise<unknown>; close(): Promise<void>;
}
export interface Vk1048PreflightResult {
    status: 'BLOCKED' | 'UNKNOWN' | 'OFFLINE_FIXTURE_CHECKED'; reason: string;
    scope: typeof VK_CONNECTOR_SCOPE & { jobId: string };
    admission: string; productionReady: false; observedAt: string; generation?: number; packageSha256?: string;
    resources?: PreflightResources; connection?: 'online' | 'offline'; objects?: number; quarantineRequired?: boolean;
}
async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error('[VK1048_PREFLIGHT_TIMEOUT]');
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new Error('[VK1048_PREFLIGHT_TIMEOUT]'));
        signal.addEventListener('abort', cancel, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(operation), cancelled]); }
    finally { if (cancel) signal.removeEventListener('abort', cancel); }
}
/** Production entry is READ+metadata only; fixtures never clear the production admission restriction. */
export async function runVk1048OperatorPreflight(rawConfig: unknown, control: VkConnectorControl, options: {
    resources?: (config: VkConnectorConfig) => PreflightResources; fixture?: Vk1048PreflightFixture;
    signal?: AbortSignal; timeoutMs?: number; cleanupMs?: number;
} = {}): Promise<Vk1048PreflightResult> {
    const result: Vk1048PreflightResult = { status: 'BLOCKED', reason: 'READINESS_SNAPSHOT_UNAVAILABLE',
        scope: { ...VK_CONNECTOR_SCOPE, jobId: JOB },
        admission: vk1048ProductionAdmission().reason, productionReady: false, observedAt: new Date().toISOString() };
    const timeout = options.timeoutMs ?? 120000, cleanup = options.cleanupMs ?? 30000;
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 120000 || !Number.isInteger(cleanup) || cleanup < 10 || cleanup > 30000)
        return { ...result, reason: 'INVALID_TIMEOUT' };
    const controller = new AbortController();
    const deadlineTimer = setTimeout(() => controller.abort(), timeout);
    const deadline = controller.signal;
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const reader = createVk1048PreflightReader(control);
    const read = (name: string, args: Record<string, unknown>) => bounded(() => reader.call(name, args, signal), signal);
    const identity = { projectId: 10, actorId: 'user:0' };
    let fixtureStarted = false;
    try {
        const config = VkConnectorConfigSchema.parse(rawConfig);
        const preview = Preview.parse(await read('ba_preview_vk_connector_dispatch', { ...identity, taskId: 1048 }));
        if (preview.packageSha256 !== PACKAGE || vkConnectorPackageSha256(preview.package) !== preview.packageSha256) throw new Error('[VK1048_PACKAGE_CHANGED]');
        const job = Status.parse(await read('ba_get_vk_connector_job', { ...identity, jobId: JOB }));
        if (job.packageSha256 !== preview.packageSha256) throw new Error('[VK1048_PACKAGE_CHANGED]');
        result.generation = job.generation; result.packageSha256 = job.packageSha256;
        const health = z.object({ hostId: z.literal('vk-connector-local-1048'), status: z.enum(['online','offline','disabled']),
            heartbeatAt: z.string().datetime({ offset: true }).nullable() }).strip()
            .parse(await read('ba_get_vk_connector_health', { ...identity, hostId: config.hostId }));
        const age = health.heartbeatAt ? Date.now() - Date.parse(health.heartbeatAt) : Infinity;
        result.connection = health.status === 'online' && age >= -1000 && age <= 30000 ? 'online' : 'offline';
        result.resources = Resources.parse((options.resources ?? inspectVk1048PreflightResources)(config));
        result.reason = result.admission;
        if (job.attemptId !== null || ['executing','verification_required','reconciling'].includes(job.state)) result.reason = 'RECONCILIATION_REQUIRED';
        else if (job.factId !== null || job.state === 'confirmed') result.reason = 'EXISTING_RESULT';
        else if (result.connection !== 'online') result.reason = 'HOST_OFFLINE';
        else if (options.fixture?.kind === 'offline_fixture' && Object.values(result.resources).every(value => value === 'PASS')) {
            fixtureStarted = true;
            const observed = Observation.parse(await bounded(() => options.fixture!.inspect(signal), signal));
            result.status = observed.loggedIn && observed.communityAdmin && observed.communityId === -240051152
                && observed.coverage === 'complete_window' && observed.mediaSha256 === preview.package.assetSha256
                ? 'OFFLINE_FIXTURE_CHECKED' : 'UNKNOWN';
            result.reason = result.status === 'OFFLINE_FIXTURE_CHECKED' ? 'OFFLINE_ONLY_NOT_PROVIDER_READINESS' : 'FIXTURE_READINESS_UNCONFIRMED';
            result.objects = observed.objects;
        }
        const after = Status.parse(await read('ba_get_vk_connector_job', { ...identity, jobId: JOB }));
        if (JSON.stringify(after) !== JSON.stringify(job)) { result.status = 'BLOCKED'; result.reason = 'SNAPSHOT_CHANGED'; }
        return result;
    } catch {
        // A malformed/stale control or fixture is diagnostic UNKNOWN; never emit its raw error/payload.
        result.status = fixtureStarted ? 'UNKNOWN' : 'BLOCKED';
        result.reason = signal.aborted ? 'TIMEOUT_OR_CANCELLED' : fixtureStarted ? 'FIXTURE_READINESS_UNCONFIRMED' : 'READINESS_SNAPSHOT_UNAVAILABLE';
        return result;
    } finally {
        try {
            if (fixtureStarted && options.fixture) {
                const cleanupController = new AbortController();
                const cleanupTimer = setTimeout(() => cleanupController.abort(), cleanup);
                try { await bounded(() => options.fixture!.close(), cleanupController.signal); }
                catch { result.status = 'UNKNOWN'; result.reason = 'SESSION_CLEANUP_UNCONFIRMED'; result.quarantineRequired = true; }
                finally { clearTimeout(cleanupTimer); }
            }
        } finally { clearTimeout(deadlineTimer); }
    }
}
