import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { VkConnectorProviderRuntime } from './vk_connector_playwright_runtime';
import type { VkConnectorProviderResult } from './vk_connector_provider_execution';
import type { VkConnectorOfflineHarness } from './vk_connector_provider_execution';
import { getVkConnectorRecordedRestriction } from './vk_connector_recorded_restriction';
import { ConnectorBindingSchema, ConnectorHostIdSchema, connectorPackageHash } from './vk_connector_contract';

/** Remote auth replaces this protocol sentinel with its credential-bound actor before tool execution. */
export const AUTHENTICATED_REMOTE_ACTOR = 'authenticated' as const;
const Actor = z.union([z.string().regex(/^user:(?:0|[1-9]\d*)$/), z.literal(AUTHENTICATED_REMOTE_ACTOR)]);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Private local configuration never contains a token value or browser/profile path. */
const ConfigBaseSchema = z.object({
    projectId: z.number().int().positive().safe(), hostId: ConnectorHostIdSchema,
    actorId: Actor.optional(),
    endpoint: z.literal('https://planner-mcp-production.up.railway.app/mcp/publisher'),
    runtimeDir: z.string().refine(path.isAbsolute),
    profileDirectory: z.string().refine(path.isAbsolute).optional(), evidenceDir: z.string().refine(path.isAbsolute).optional(),
    mode: z.enum(['infrastructure_only', 'vk_feed_provider']), buildVersion: z.string().min(1).max(100)
}).strict();
export const VkConnectorConfigSchema = z.union([
    ConfigBaseSchema.extend({ tokenFile: z.string().refine(path.isAbsolute) }),
    ConfigBaseSchema.extend({ tokenEnvVar: z.string().regex(/^CONTENTOPS_[A-Z0-9_]{1,100}_PUBLISHER_TOKEN$/) })
]).refine(config => Boolean(config.profileDirectory) === Boolean(config.evidenceDir), { message: 'Operator resources must be provided together' });
export type VkConnectorConfig = z.infer<typeof VkConnectorConfigSchema>;
/** Shared immutable package data. Validation is identical for every tenant and format. */
export const VkConnectorPackageSchema = ConnectorBindingSchema;
export type VkConnectorPackage = z.infer<typeof VkConnectorPackageSchema>;
/** Legacy source compatibility only; validation/authority is the shared data contract. */
export const VkConnectorPilotPackageSchema = VkConnectorPackageSchema;
export type VkConnectorPilotPackage = VkConnectorPackage;
const IdentitySchema = z.object({ projectId: z.number().int().positive().safe(), actorId: Actor, hostId: ConnectorHostIdSchema,
    instanceId: z.string().uuid(), buildVersion: z.string().min(1).max(100),
    mode: z.enum(['infrastructure_only', 'vk_feed_provider']).default('infrastructure_only') }).strict();
export type VkConnectorIdentity = z.infer<typeof IdentitySchema>;
const HealthSchema = z.object({ hostId: ConnectorHostIdSchema, mode: z.enum(['infrastructure_only', 'vk_feed_provider']),
    providerExecution: z.literal('blocked'), status: z.enum(['online', 'offline', 'disabled']), heartbeatAt: z.string().datetime({ offset: true }).nullable() }).strict();
const JobSchema = z.object({ jobId: z.string().uuid(), packageSha256: Hash, generation: z.number().int().nonnegative(),
    package: VkConnectorPackageSchema, recordedRestrictions: z.unknown().optional(), state: z.enum(['queued', 'accepted']).default('queued') }).strict();
const PollSchema = z.object({ jobs: z.array(JobSchema).max(1), health: HealthSchema }).strict();
const AckSchema = z.object({ jobId: z.string().uuid(), generation: z.number().int().nonnegative(),
    state: z.enum(['accepted', 'blocked']), blocker: z.string().max(100).nullable().optional() }).strip();
const ReportSchema = z.object({ jobId: z.string().uuid(), generation: z.number().int().nonnegative(),
    state: z.literal('blocked'), blocker: z.enum(['PROVIDER_CONTROL_DENIED', 'PROVIDER_PERMISSION_UNVERIFIED', 'NOT_CONNECTED', 'POLICY_DENIED']) }).strip();
/** Outbound authenticated MCP port, isolated from every provider implementation. */
export interface VkConnectorControl {
    call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
    close(): Promise<void>;
}
interface Receipt { jobId: string; generation: number; state: 'accepted' | 'blocked' | 'confirmed' | 'verification_required'; }
export interface VkConnectorCycleResult {
    status: 'idle_provider_blocked' | 'receipt_provider_blocked' | 'stale_generation' | 'invalid_response' | 'auth_or_control_unavailable' | 'provider_confirmed' | 'provider_verification_required';
    mode: 'infrastructure_only' | 'vk_feed_provider'; providerExecution: 'blocked' | 'confirmed'; blocker: 'PROVIDER_CONTROL_DENIED' | 'PROVIDER_PERMISSION_UNVERIFIED' | 'NOT_CONNECTED' | 'POLICY_DENIED' | null;
    providerReason?: string; receipts: Receipt[]; heartbeatAt: string | null;
}
/** Stable package digest uses this fixed ordered projection in both producer and consumer. */
export function vkConnectorPackageSha256(rawPackage: unknown): string {
    const p = VkConnectorPackageSchema.parse(rawPackage);
    return connectorPackageHash(p);
}
async function boundedCall(control: VkConnectorControl, name: string, args: Record<string, unknown>,
    signal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
    const abort = new AbortController();
    const stop = (): void => abort.abort();
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) abort.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    try {
        if (abort.signal.aborted) throw new Error('[VK_CONNECTOR_ABORTED]');
        const cancelled = new Promise<never>((_resolve, reject) => {
            rejectAbort = (): void => reject(new Error('[VK_CONNECTOR_CONTROL_TIMEOUT_OR_ABORT]'));
            abort.signal.addEventListener('abort', rejectAbort, { once: true });
            timer = setTimeout(() => abort.abort(), timeoutMs);
        });
        return await Promise.race([Promise.resolve().then(() => control.call(name, args, abort.signal)), cancelled]);
    } finally {
        if (timer) clearTimeout(timer);
        if (rejectAbort) abort.signal.removeEventListener('abort', rejectAbort);
        signal?.removeEventListener('abort', stop);
    }
}
export interface VkConnectorProviderInput { identity: VkConnectorIdentity; jobId: string; generation: number; packageSha256: string; binding: VkConnectorPackage; }
export type VkConnectorProviderDispatch = (input: VkConnectorProviderInput, control: VkConnectorControl, signal?: AbortSignal) => Promise<VkConnectorProviderResult>;
/** One serial poll/ack/report cycle. There is no provider-navigation or publication capability. */
export async function consumeVkConnectorOnce(rawIdentity: unknown, control: VkConnectorControl, signal?: AbortSignal, timeoutMs = 15_000, offlineHarness?: VkConnectorOfflineHarness | VkConnectorProviderRuntime, providerDispatch?: VkConnectorProviderDispatch): Promise<VkConnectorCycleResult> {
    const identity = IdentitySchema.parse(rawIdentity);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 15_000) throw new Error('[VK_CONNECTOR_TIMEOUT_INVALID]');
    const call = (name: string, args: Record<string, unknown>): Promise<unknown> => boundedCall(control, name, args, signal, timeoutMs);
    const result: VkConnectorCycleResult = { status: 'idle_provider_blocked', mode: identity.mode,
        providerExecution: 'blocked', blocker: identity.mode === 'vk_feed_provider' ? 'PROVIDER_PERMISSION_UNVERIFIED' : 'PROVIDER_CONTROL_DENIED', receipts: [], heartbeatAt: null };
    try {
        const poll = PollSchema.safeParse(await call('ba_poll_vk_connector_jobs', identity));
        if (!poll.success) { result.status = 'invalid_response'; return result; }
        result.heartbeatAt = poll.data.health.heartbeatAt;
        if (poll.data.health.hostId !== identity.hostId || poll.data.health.mode !== identity.mode) { result.status = 'invalid_response'; return result; }
        if (poll.data.health.status !== 'online') { result.status = 'auth_or_control_unavailable'; return result; }
        for (const job of poll.data.jobs) {
            if (signal?.aborted) break;
            if (job.package.projectId !== identity.projectId || vkConnectorPackageSha256(job.package) !== job.packageSha256) { result.status = 'invalid_response'; break; }
            const restriction = getVkConnectorRecordedRestriction(job.package, job.recordedRestrictions === undefined ? [] : job.recordedRestrictions, 'publication');
            let generation = job.generation;
            if (job.state === 'queued') {
                const ack = AckSchema.safeParse(await call('ba_ack_vk_connector_job', { ...identity,
                    jobId: job.jobId, packageSha256: job.packageSha256, generation: job.generation }));
                if (!ack.success || ack.data.jobId !== job.jobId) { result.status = 'invalid_response'; break; }
                if (ack.data.state !== 'accepted' || ack.data.generation !== job.generation + 1) { result.status = 'stale_generation'; break; }
                generation = ack.data.generation;
            } else if (generation < 1) { result.status = 'stale_generation'; break; }
            // Accepted jobs are returned only for this authenticated instance by the server.
            // Resume the idempotent infrastructure blocker report, never re-ACK or dispatch.
            result.receipts.push({ jobId: job.jobId, generation, state: 'accepted' });
            if (restriction) result.blocker = 'POLICY_DENIED';
            if (identity.mode === 'vk_feed_provider' && !restriction) {
                const { runVkConnectorProviderJob } = await import('./vk_connector_provider_execution');
                const input = { identity, jobId: job.jobId, generation, packageSha256: job.packageSha256, binding: job.package };
                const provider = providerDispatch ? await providerDispatch(input, control, signal)
                    : await runVkConnectorProviderJob(input, control, offlineHarness, signal);
                if (provider.status === 'provider_confirmed') {
                    result.status = 'provider_confirmed'; result.providerExecution = 'confirmed'; result.blocker = null;
                    result.receipts[result.receipts.length - 1] = { jobId: job.jobId, generation: provider.generation ?? generation, state: 'confirmed' }; break;
                }
                if (provider.status === 'verification_required') {
                    result.providerReason = provider.reason; result.status = 'provider_verification_required'; result.receipts[result.receipts.length - 1].state = 'verification_required'; break;
                }
                if (provider.reason === 'NOT_CONNECTED') result.blocker = 'NOT_CONNECTED';
                // Production admission is unverified. No job/config/MCP value can supply an offline harness.
                result.blocker ??= 'PROVIDER_PERMISSION_UNVERIFIED';
                if (provider.executionContext === 'offline_fixture') { result.status = 'invalid_response'; break; }
            }
            const report = ReportSchema.safeParse(await call('ba_report_vk_connector_job', { ...identity,
                jobId: job.jobId, generation, blocker: result.blocker }));
            if (!report.success || report.data.jobId !== job.jobId || report.data.generation !== generation) {
                result.status = 'invalid_response'; break;
            }
            result.receipts[result.receipts.length - 1].state = 'blocked';
            result.status = 'receipt_provider_blocked';
        }
    } catch { result.status = 'auth_or_control_unavailable'; /* Raw MCP/provider diagnostics never leave this boundary. */ }
    return result;
}
function privateFile(file: string): string {
    if (!path.isAbsolute(file)) throw new Error('[VK_CONNECTOR_PRIVATE_FILE_REQUIRED]');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 64_000
            || (process.getuid && stat.uid !== process.getuid())) throw new Error('[VK_CONNECTOR_PRIVATE_FILE_REQUIRED]');
        return fs.readFileSync(fd, 'utf8');
    } finally { fs.closeSync(fd); }
}
/** Read owner-only configuration without following a symlink. */
export function loadVkConnectorConfig(file: string): VkConnectorConfig { return VkConnectorConfigSchema.parse(JSON.parse(privateFile(file))); }
/** Read an existing private file or pinned process environment credential; never persist the value. */
export function readVkConnectorToken(config: VkConnectorConfig): string {
    try {
        const token = ('tokenEnvVar' in config
            ? process.env[config.tokenEnvVar] ?? '' : privateFile(config.tokenFile)).trim();
        if (!token || token.length > 16_000 || /[\x00-\x20\x7f]/.test(token)) throw new Error('Invalid credential');
        return token;
    } catch { throw new Error('[VK_CONNECTOR_AUTH_UNAVAILABLE]'); }
}
/** Acquire an exclusive process lock. Crash leftovers require reviewed manual cleanup, never auto-unlink. */
export function acquireVkConnectorLock(config: VkConnectorConfig): { instanceId: string; release(): void } {
    fs.mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 });
    const dir = fs.lstatSync(config.runtimeDir);
    if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o777) !== 0o700
        || (process.getuid && dir.uid !== process.getuid())) throw new Error('[VK_CONNECTOR_PRIVATE_DIRECTORY_REQUIRED]');
    const lockPath = path.join(config.runtimeDir, 'consumer.lock');
    let fd: number;
    try { fd = fs.openSync(lockPath, 'wx', 0o600); }
    catch { throw new Error('[VK_CONNECTOR_ALREADY_RUNNING_OR_STALE_LOCK]'); }
    const instanceId = randomUUID();
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, instanceId, mode: config.mode })); }
    catch {
        fs.closeSync(fd);
        throw new Error('[VK_CONNECTOR_LOCK_INITIALIZATION_FAILED]');
    }
    let released = false;
    return { instanceId, release(): void {
        if (released) return;
        released = true;
        try {
            const current = z.object({ pid: z.number().int().positive(), instanceId: z.string().uuid(), mode: z.enum(['infrastructure_only', 'vk_feed_provider']) })
                .parse(JSON.parse(privateFile(lockPath)));
            if (current.instanceId !== instanceId) throw new Error('[VK_CONNECTOR_LOCK_OWNERSHIP_CHANGED]');
            fs.unlinkSync(lockPath);
        } finally { fs.closeSync(fd); }
    } };
}
/** Persist only a private, non-secret infrastructure receipt/health projection. */
export function writeVkConnectorHealth(config: VkConnectorConfig, instanceId: string, result: VkConnectorCycleResult): void {
    const file = path.join(config.runtimeDir, `health-${instanceId}.json`);
    fs.writeFileSync(file, JSON.stringify({ instanceId, observedAt: new Date().toISOString(), ...result }), { mode: 0o600 });
}
