import { createHash } from 'node:crypto';

export const VK_CONNECTOR_HOST = 'vk-connector-local-1048';
export const VK_CONNECTOR_SCOPE = { projectId: 10, taskId: 1048, channelId: 117,
    revision: 1, selectedAssetId: 130, communityId: -240051152, placement: 'feed' } as const;
export type ConnectorBinding = typeof VK_CONNECTOR_SCOPE & {
    bodySha256: string; assetSha256: string; releaseSha256: string;
};
export type ConnectorSnapshot = { package: ConnectorBinding; workItemId: number;
    factId: number | null; publicUrl: string | null; attemptId: number | null;
    attemptStatus: string | null; eligible: boolean };
export type ConnectorState = 'queued' | 'accepted' | 'blocked' | 'verification_required' | 'confirmed';
export type ConnectorJob = { jobId: string; projectId: number; taskId: number; channelId: number;
    workItemId: number; package: ConnectorBinding; packageSha256: string; idempotencyKey: string;
    state: ConnectorState; hostId: string | null; instanceId: string | null; generation: number;
    receiptAt: Date | null; updatedAt: Date; blocker: string | null;
    attemptId: number | null; factId: number | null };
export type ConnectorHost = { projectId: number; hostId: string; instanceId: string;
    buildVersion: string; heartbeatAt: Date; mode: 'infrastructure_only'; blocker: string | null };
export type JobPatch = Partial<Pick<ConnectorJob, 'state' | 'hostId' | 'instanceId' | 'generation'
    | 'receiptAt' | 'blocker' | 'attemptId' | 'factId'>> & { updatedAt: Date };
export interface ConnectorStore {
    authorize(projectId: number, actorId: string, mutation: boolean): Promise<void>;
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
        data: { jobId?: string; state?: string; generation?: number; blocker?: string }): Promise<void>;
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
export type ConnectorHealth = { hostId: string; mode: 'infrastructure_only'; providerExecution: 'blocked';
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
