import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const positiveId = z.number().int().positive();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const ConnectorHostIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
/** Tenant-owned snapshot data, not a publication-specific execution allowlist. */
export const ConnectorBindingSchema = z.object({ projectId: positiveId, taskId: positiveId, channelId: positiveId,
    communityId: z.number().int().negative(), revision: positiveId, selectedAssetId: positiveId,
    placement: z.enum(['feed', 'clip']), bodySha256: sha256, assetSha256: sha256, releaseSha256: sha256 }).strict();
export type ConnectorBinding = z.infer<typeof ConnectorBindingSchema>;
export type ConnectorSnapshot = { package: ConnectorBinding; workItemId: number;
    factId: number | null; publicUrl: string | null; attemptId: number | null;
    attemptStatus: string | null; eligible: boolean };
export type ConnectorState = 'queued' | 'accepted' | 'blocked' | 'verification_required' | 'confirmed' | 'reconciling' | 'ready' | 'executing' | 'cancelled';
export type ConnectorJob = { jobId: string; projectId: number; taskId: number; channelId: number;
    workItemId: number; package: ConnectorBinding; packageSha256: string; idempotencyKey: string;
    state: ConnectorState; hostId: string | null; instanceId: string | null; generation: number;
    receiptAt: Date | null; updatedAt: Date; blocker: string | null;
    attemptId: number | null; factId: number | null; canonicalLeaseSha256?: string | null; canonicalLeaseExpiresAt?: Date | null };
export type ConnectorHost = { projectId: number; hostId: string; instanceId: string;
    buildVersion: string; heartbeatAt: Date; mode: 'infrastructure_only' | 'vk_feed_provider'; blocker: string | null };
export type JobPatch = Partial<Pick<ConnectorJob, 'state' | 'hostId' | 'instanceId' | 'generation'
    | 'receiptAt' | 'blocker' | 'attemptId' | 'factId' | 'canonicalLeaseSha256' | 'canonicalLeaseExpiresAt'>> & { updatedAt: Date };
export interface ConnectorStore {
    authorize(projectId: number, actorId: string, mutation: boolean): Promise<void>;
    bindLease?(projectId: number, actorId: string, leaseToken: string, leaseExpiresAt: string,
        binding: { taskId: number; workItemId: number }): Promise<void>;
    commandResult?(projectId: number, actorId: string, command: string, key: string): Promise<unknown>;
    executionPackage?(projectId: number, taskId: number): Promise<ConnectorExecutionPackage>;
    snapshot(projectId: number, taskId: number): Promise<ConnectorSnapshot>;
    job(projectId: number, jobId: string): Promise<ConnectorJob | null>;
    jobByKey(projectId: number, key: string): Promise<ConnectorJob | null>;
    jobByPackage(projectId: number, sha256: string): Promise<ConnectorJob | null>;
    insertJob(job: ConnectorJob): Promise<void>;
    updateJob(jobId: string, generation: number, state: ConnectorState, patch: JobPatch): Promise<boolean>;
    candidates(projectId: number): Promise<ConnectorJob[]>;
    host(projectId: number, hostId: string): Promise<ConnectorHost | null>;
    saveHost(host: ConnectorHost): Promise<void>;
    event(projectId: number, taskId: number | null, actorId: string, command: string,
        data: ConnectorAuditData): Promise<void>;
}
export interface ConnectorRepository {
    transaction<T>(run: (store: ConnectorStore) => Promise<T>): Promise<T>;
}
export type ConnectorIdentity = { projectId: number; actorId: string };
export type ConsumerIdentity = ConnectorIdentity & { hostId: string; instanceId: string };
export type ConsumerJobIdentity = ConsumerIdentity & { jobId: string; generation: number };
export type ConnectorJobStatus = { jobId: string; state: ConnectorState; packageSha256: string;
    generation: number; receiptAt: string | null; blocker: string | null; attemptId: number | null;
    factId: number | null; publicUrl: string | null };
export type ConnectorHealth = { hostId: string; mode: 'infrastructure_only' | 'vk_feed_provider'; providerExecution: 'blocked';
    status: 'disabled' | 'offline' | 'online'; heartbeatAt: string | null };
export type ConnectorPoll = { jobs: { jobId: string; packageSha256: string; generation: number;
    state: 'queued' | 'accepted'; package: ConnectorBinding }[]; health: ConnectorHealth };
export function connectorHash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function connectorPackageHash(binding: ConnectorBinding): string {
    return connectorHash(JSON.stringify({ projectId: binding.projectId, taskId: binding.taskId, channelId: binding.channelId,
        communityId: binding.communityId, revision: binding.revision, selectedAssetId: binding.selectedAssetId,
        placement: binding.placement, bodySha256: binding.bodySha256,
        assetSha256: binding.assetSha256, releaseSha256: binding.releaseSha256 }));
}

export type ConnectorAuditData = { jobId?: string; state?: string; generation?: number; blocker?: string;
    previousState?: string; previousBlocker?: string | null; previousGeneration?: number;
    previousReceiptAt?: string | null; packageSha256?: string; requestSha256?: string; idempotencyKey?: string };
/** Protected ephemeral execution content, never persisted in dispatch or audit rows. */
export type ConnectorExecutionPackage = { binding: ConnectorBinding; packageSha256: string; body: string;
    asset: { id: number; url: string; sha256: string }; approvalReference: string; releasedAt: string;
    workItemId: number; permissionStatus: 'NOT_CHECKED' | 'POLICY_DENIED' | 'PERMITTED'; providerExecution: 'blocked' | 'permitted' };

/** Constant-size comparison for lease secrets and their private fingerprints. */
export function connectorSecretEqual(left: string, right: string): boolean {
    return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}
