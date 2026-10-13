import { randomUUID } from 'node:crypto';
import { connectorPackageHash, connectorHash, VK_CONNECTOR_HOST, VK_CONNECTOR_SCOPE,
    type ConnectorRepository, type ConnectorIdentity, type ConsumerIdentity, type ConsumerJobIdentity,
    type ConnectorBinding, type ConnectorHealth, type ConnectorJob, type ConnectorJobStatus,
    type ConnectorPoll, type ConnectorStore } from './vk_connector_contract';

const FRESH_MS = 30_000;
function packageInvalid(error: unknown): boolean {
    return error instanceof Error && ['[VK_CONNECTOR_PACKAGE_CHANGED]', '[VK_CONNECTOR_PACKAGE_NOT_READY]'].includes(error.message);
}
function fail(code: string): never { throw new Error(`[VK_CONNECTOR_${code}]`); }
function view(job: ConnectorJob, publicUrl: string | null = null): ConnectorJobStatus {
    return { jobId: job.jobId, state: job.state, packageSha256: job.packageSha256, generation: job.generation,
        receiptAt: job.receiptAt?.toISOString() || null, blocker: job.blocker,
        attemptId: job.attemptId, factId: job.factId, publicUrl };
}

/** Transport receipts never grant provider authority. This rollout cannot navigate to VK. */
export class VkConnectorDispatchService {
    constructor(private readonly repository: ConnectorRepository,
        private readonly enabled = false, private readonly now = () => new Date()) {}
    private scope(args: ConnectorIdentity, taskId: number = VK_CONNECTOR_SCOPE.taskId) {
        if (args.projectId !== 10 || taskId !== 1048) fail('SCOPE_MISMATCH');
    }
    private liveInfrastructure() { if (!this.enabled) fail('DISABLED'); }
    private consumer(args: ConsumerIdentity) {
        this.scope(args);
        if (args.hostId !== VK_CONNECTOR_HOST || !/^[a-f0-9-]{36}$/i.test(args.instanceId)) fail('HOST_IDENTITY_INVALID');
    }
    private async exact(store: ConnectorStore, args: ConnectorIdentity, job: ConnectorJob) {
        const current = await store.snapshot(args.projectId, job.taskId);
        if (connectorPackageHash(current.package) !== job.packageSha256) fail('PACKAGE_CHANGED');
        return current;
    }
    private async owned(store: ConnectorStore, args: ConsumerJobIdentity) {
        const job = await store.job(args.projectId, args.jobId);
        if (!job) fail('JOB_NOT_FOUND');
        const host = await store.host(args.projectId, args.hostId);
        if (!host || host.instanceId !== args.instanceId || this.now().getTime() - host.heartbeatAt.getTime() > FRESH_MS
            || job.hostId !== args.hostId || job.instanceId !== args.instanceId || job.generation !== args.generation) fail('FENCED');
        return job;
    }
    private async patch(store: ConnectorStore, job: ConnectorJob,
        patch: Parameters<ConnectorStore['updateJob']>[3], actorId: string) {
        if (!await store.updateJob(job.jobId, job.generation, job.state, patch)) fail('CAS_CONFLICT');
        Object.assign(job, patch);
        await store.event(job.projectId, job.taskId, actorId, 'vk_connector_transition',
            { jobId: job.jobId, state: job.state, generation: job.generation, blocker: job.blocker || undefined });
    }
    private async existingOutcome(store: ConnectorStore, args: ConnectorIdentity, job: ConnectorJob) {
        const current = await this.exact(store, args, job);
        if (current.factId && current.publicUrl) {
            if (job.state !== 'confirmed') await this.patch(store, job, { state: 'confirmed', factId: current.factId,
                attemptId: current.attemptId, blocker: null, updatedAt: this.now() }, args.actorId);
            return view(job, current.publicUrl);
        }
        if (current.attemptId) {
            if (job.state !== 'verification_required') await this.patch(store, job, { state: 'verification_required',
                attemptId: current.attemptId, blocker: 'PROVIDER_VERIFICATION_REQUIRED', updatedAt: this.now() }, args.actorId);
            return view(job);
        }
        return null;
    }
    async preview(args: ConnectorIdentity & { taskId: number }): Promise<{package: ConnectorBinding; packageSha256: string}> {
        this.scope(args, args.taskId);
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, false);
            const snapshot = await store.snapshot(args.projectId, args.taskId);
            return { package: snapshot.package, packageSha256: connectorPackageHash(snapshot.package) };
        });
    }
    async dispatch(args: ConnectorIdentity & { taskId: number; expectedPackageSha256: string; idempotencyKey: string }): Promise<ConnectorJobStatus> {
        this.scope(args, args.taskId); this.liveInfrastructure();
        if (!/^[a-f0-9]{64}$/.test(args.expectedPackageSha256) || !/^[a-zA-Z0-9:_-]{1,160}$/.test(args.idempotencyKey)) fail('INPUT_INVALID');
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const current = await store.snapshot(args.projectId, args.taskId);
            const hash = connectorPackageHash(current.package);
            if (hash !== args.expectedPackageSha256) fail('PACKAGE_CHANGED');
            const old = await store.jobByKey(args.projectId, args.idempotencyKey)
                || await store.jobByPackage(args.projectId, hash);
            if (old) {
                if (old.packageSha256 !== hash) fail('IDEMPOTENCY_CONFLICT');
                return await this.existingOutcome(store, args, old) || view(old);
            }
            if (current.factId || current.publicUrl) fail('ALREADY_PUBLISHED');
            if (current.attemptId) fail('VERIFICATION_REQUIRED');
            if (!current.eligible) fail('PACKAGE_NOT_READY');
            const job: ConnectorJob = { jobId: randomUUID(), projectId: args.projectId, taskId: args.taskId,
                channelId: current.package.channelId, workItemId: current.workItemId, package: current.package,
                packageSha256: hash, idempotencyKey: args.idempotencyKey, state: 'queued', hostId: null,
                instanceId: null, generation: 0, receiptAt: null, updatedAt: this.now(), blocker: null,
                attemptId: null, factId: null };
            await store.insertJob(job);
            await store.event(args.projectId, args.taskId, args.actorId, 'vk_connector_dispatch', { jobId: job.jobId, state: job.state });
            return view(job);
        });
    }
    /** Owner-only same-job resume. This queues infrastructure; it never changes provider permission. */
    async resume(args: ConnectorIdentity & { jobId: string; expectedGeneration: number;
        expectedPackageSha256: string; approvalReference: string; idempotencyKey: string }): Promise<ConnectorJobStatus> {
        this.scope(args); this.liveInfrastructure();
        if (!args.approvalReference.trim() || args.approvalReference.length > 2048
            || !/^[a-zA-Z0-9:_-]{1,160}$/.test(args.idempotencyKey)) fail('INPUT_INVALID');
        const requestSha = connectorHash(JSON.stringify(args));
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await store.job(args.projectId, args.jobId); if (!job) fail('JOB_NOT_FOUND');
            const prior = await store.commandResult?.(args.projectId, args.actorId, 'vk_connector_owner_resume', args.idempotencyKey);
            if (prior && typeof prior === 'object' && 'requestSha256' in prior) {
                if (prior.requestSha256 !== requestSha) fail('IDEMPOTENCY_CONFLICT');
                return view(job);
            }
            const current = await this.exact(store, args, job);
            if (job.packageSha256 !== args.expectedPackageSha256) fail('PACKAGE_CHANGED');
            if (current.attemptId || current.factId || current.publicUrl) fail('VERIFICATION_REQUIRED');
            if (!current.eligible) fail('PACKAGE_NOT_READY');
            if (job.state !== 'blocked' || job.generation !== args.expectedGeneration) fail('CAS_CONFLICT');
            const before = { previousState: job.state, previousBlocker: job.blocker,
                previousGeneration: job.generation, previousReceiptAt: job.receiptAt?.toISOString() || null };
            await this.patch(store, job, { state: 'queued', generation: job.generation + 1,
                hostId: null, instanceId: null, blocker: 'PROVIDER_PERMISSION_UNVERIFIED',
                canonicalLeaseSha256: null, canonicalLeaseExpiresAt: null, updatedAt: this.now() }, args.actorId);
            await store.event(job.projectId, job.taskId, args.actorId, 'vk_connector_owner_resume', {
                ...before, jobId: job.jobId, state: job.state, generation: job.generation,
                packageSha256: job.packageSha256, requestSha256: requestSha, idempotencyKey: args.idempotencyKey });
            return view(job);
        });
    }
    /** Reading content is generation fenced; NOT_CHECKED never becomes provider authority. */
    async executionPackage(args: ConsumerJobIdentity & { packageSha256: string }) {
        this.consumer(args); this.liveInfrastructure();
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await this.owned(store, args);
            await this.exact(store, args, job);
            if (args.packageSha256 !== job.packageSha256 || !['accepted', 'reconciling', 'ready', 'executing', 'verification_required'].includes(job.state)) fail('FENCED');
            if (!store.executionPackage) fail('EXECUTION_PACKAGE_UNAVAILABLE');
            return { ...await store.executionPackage(args.projectId, job.taskId),
                permissionStatus: 'NOT_CHECKED' as const, providerExecution: 'blocked' as const };
        });
    }
    async health(args: ConnectorIdentity & { hostId: string }): Promise<ConnectorHealth> {
        this.scope(args); if (args.hostId !== VK_CONNECTOR_HOST) fail('HOST_IDENTITY_INVALID');
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, false);
            const host = await store.host(args.projectId, args.hostId);
            return { hostId: args.hostId, mode: host?.mode || 'infrastructure_only', providerExecution: 'blocked',
                status: !this.enabled ? 'disabled' : host && this.now().getTime() - host.heartbeatAt.getTime() <= FRESH_MS ? 'online' : 'offline',
                heartbeatAt: host?.heartbeatAt.toISOString() || null };
        });
    }
    async poll(args: ConsumerIdentity & { buildVersion: string; mode?: 'infrastructure_only' | 'vk_feed_provider' }): Promise<ConnectorPoll> {
        this.consumer(args); this.liveInfrastructure();
        if (!/^[a-zA-Z0-9._-]{1,80}$/.test(args.buildVersion)) fail('BUILD_INVALID');
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const now = this.now(), old = await store.host(args.projectId, args.hostId);
            if (old && old.instanceId !== args.instanceId && now.getTime() - old.heartbeatAt.getTime() <= FRESH_MS) fail('HOST_BUSY');
            await store.saveHost({ projectId: args.projectId, hostId: args.hostId, instanceId: args.instanceId,
                buildVersion: args.buildVersion, heartbeatAt: now, mode: args.mode || 'infrastructure_only',
                blocker: args.mode === 'vk_feed_provider' ? 'PROVIDER_PERMISSION_UNVERIFIED' : 'PROVIDER_CONTROL_DENIED' });
            const jobs: ConnectorPoll['jobs'] = [];
            for (const job of await store.candidates(args.projectId)) {
                if (['reconciling','ready','executing'].includes(job.state)) {
                    let canonical;
                    try { canonical = await this.exact(store, args, job); }
                    catch (error) {
                        if (!packageInvalid(error)) throw error;
                        await this.patch(store, job, { state: 'verification_required', generation: job.generation + 1,
                            blocker: error instanceof Error && error.message.includes('NOT_READY')
                                ? 'PACKAGE_NOT_READY' : 'PACKAGE_CHANGED', updatedAt: now }, args.actorId);
                        continue;
                    }
                    if (canonical.factId && canonical.publicUrl) { await this.existingOutcome(store, args, job); continue; }
                    if (job.instanceId === args.instanceId && old?.instanceId === args.instanceId
                        && now.getTime() - old.heartbeatAt.getTime() <= FRESH_MS) continue;
                    await this.patch(store, job, { state: 'verification_required', generation: job.generation + 1,
                        blocker: 'EXECUTION_INTERRUPTED', attemptId: canonical.attemptId, updatedAt: now }, args.actorId);
                    continue;
                }
                let current;
                try { current = await this.exact(store, args, job); }
                catch (error) {
                    if (!packageInvalid(error)) throw error;
                    await this.patch(store, job, { state: 'blocked', blocker: error instanceof Error && error.message.includes('NOT_READY')
                        ? 'PACKAGE_NOT_READY' : 'PACKAGE_CHANGED', updatedAt: now }, args.actorId); continue;
                }
                if (await this.existingOutcome(store, args, job)) continue;
                if (!current.eligible) { await this.patch(store, job, { state: 'blocked', blocker: 'PACKAGE_NOT_READY', updatedAt: now }, args.actorId); continue; }
                if (job.state === 'accepted') {
                    if (job.instanceId === args.instanceId && job.hostId === args.hostId) {
                        jobs.push({ jobId: job.jobId, packageSha256: job.packageSha256, generation: job.generation,
                            state: 'accepted', package: job.package }); break;
                    }
                    if (old && now.getTime() - old.heartbeatAt.getTime() <= FRESH_MS) continue;
                    await this.patch(store, job, { state: 'queued', generation: job.generation + 1, hostId: null,
                        instanceId: null, receiptAt: null, blocker: null, updatedAt: now }, args.actorId);
                }
                jobs.push({ jobId: job.jobId, packageSha256: job.packageSha256, generation: job.generation, state: 'queued', package: job.package });
                break;
            }
            return { jobs, health: { hostId: args.hostId, status: 'online', mode: args.mode || 'infrastructure_only',
                providerExecution: 'blocked', heartbeatAt: now.toISOString() } };
        });
    }
    async ack(args: ConsumerJobIdentity & { packageSha256: string }): Promise<ConnectorJobStatus> {
        this.consumer(args); this.liveInfrastructure();
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await store.job(args.projectId, args.jobId); if (!job) fail('JOB_NOT_FOUND');
            const current = await this.exact(store, args, job);
            if (args.packageSha256 !== job.packageSha256) fail('PACKAGE_CHANGED');
            const host = await store.host(args.projectId, args.hostId);
            if (!host || host.instanceId !== args.instanceId || this.now().getTime() - host.heartbeatAt.getTime() > FRESH_MS) fail('FENCED');
            if (job.generation !== args.generation || job.state !== 'queued') fail('CAS_CONFLICT');
            if (current.attemptId || current.factId || !current.eligible) fail('VERIFICATION_REQUIRED');
            await this.patch(store, job, { state: 'accepted', generation: job.generation + 1, hostId: args.hostId,
                instanceId: args.instanceId, receiptAt: this.now(), updatedAt: this.now() }, args.actorId);
            return view(job);
        });
    }
    async report(args: ConsumerJobIdentity & { blocker: 'PROVIDER_CONTROL_DENIED' | 'PROVIDER_PERMISSION_UNVERIFIED' | 'NOT_CONNECTED' | 'LOGIN_REQUIRED' | 'COVERAGE_UNKNOWN' | 'MEDIA_UNCONFIRMED' | 'ACTIVE_ATTEMPT' | 'POLICY_DENIED' }): Promise<ConnectorJobStatus> {
        this.consumer(args); this.liveInfrastructure();
        if (!['PROVIDER_CONTROL_DENIED','PROVIDER_PERMISSION_UNVERIFIED','NOT_CONNECTED','LOGIN_REQUIRED','COVERAGE_UNKNOWN','MEDIA_UNCONFIRMED','ACTIVE_ATTEMPT','POLICY_DENIED'].includes(args.blocker)) fail('BLOCKER_INVALID');
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await this.owned(store, args);
            const outcome = await this.existingOutcome(store, args, job); if (outcome) return outcome;
            if (job.state !== 'accepted' && job.state !== 'blocked') fail('CAS_CONFLICT');
            if (job.state !== 'blocked') await this.patch(store, job, { state: 'blocked', blocker: args.blocker, updatedAt: this.now() }, args.actorId);
            return view(job);
        });
    }
    async status(args: ConnectorIdentity & { jobId: string }): Promise<ConnectorJobStatus> {
        this.scope(args);
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, false);
            const job = await store.job(args.projectId, args.jobId); if (!job) fail('JOB_NOT_FOUND');
            try {
                const current = await store.snapshot(args.projectId, job.taskId);
                return view(job, current.factId === job.factId ? current.publicUrl : null);
            } catch (error) {
                if (!packageInvalid(error)) throw error;
                return { ...view(job), blocker: job.blocker || 'PACKAGE_NOT_READY' };
            }
        });
    }
    async reconcile(args: ConnectorIdentity & { jobId: string }): Promise<ConnectorJobStatus> {
        this.scope(args); this.liveInfrastructure();
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await store.job(args.projectId, args.jobId); if (!job) fail('JOB_NOT_FOUND');
            return await this.existingOutcome(store, args, job) || { ...view(job), blocker: 'PROVIDER_CONTROL_DENIED' };
        });
    }
}
