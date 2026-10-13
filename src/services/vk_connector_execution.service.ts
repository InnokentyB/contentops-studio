import { connectorHash, connectorPackageHash, connectorSecretEqual, type ConnectorRepository, type ConnectorJob, type ConnectorStore } from './vk_connector_contract';
import { VkConnectorDispatchService } from './vk_connector_dispatch.service';
import { evaluateVkConnectorReconciliation } from './vk_connector_reconciliation';
import { validateVkPostConfirmation } from './vk_post_confirmation';
import type { ConnectorExecutionIdentity, ConnectorExecutionLease, ConnectorStartArgs, ConnectorConfirmArgs,
    ConnectorUncertainArgs, VkConnectorExecutionPorts } from './vk_connector_execution_contract';
function fail(code: string): never { throw new Error(`[VK_CONNECTOR_${code}]`); }

/** Permission/source ports default unavailable in production; no caller boolean permits execution. */
export class VkConnectorExecutionService {
    constructor(private readonly dispatch: VkConnectorDispatchService, private readonly repository: ConnectorRepository,
        private readonly ports: VkConnectorExecutionPorts, private readonly now = () => new Date()) {}
    private async permission(): Promise<void> {
        const status = await this.ports.admission();
        if (status !== 'PERMITTED') fail(status === 'POLICY_DENIED' ? 'POLICY_DENIED' : 'PROVIDER_PERMISSION_UNVERIFIED');
    }
    async package(args: ConnectorExecutionIdentity) {
        const execution = await this.dispatch.executionPackage(args);
        const permissionStatus = await this.ports.admission();
        return { ...execution, lease: null, permissionStatus,
            providerExecution: permissionStatus === 'PERMITTED' ? 'permitted' as const : 'blocked' as const };
    }
    private async context(args: ConnectorExecutionIdentity) {
        await this.permission();
        const execution = await this.dispatch.executionPackage(args);
        await this.repository.transaction(async store => {
            const host = await store.host(args.projectId, args.hostId);
            if (host?.mode !== 'vk_feed_provider') fail('PROVIDER_MODE_REQUIRED');
        });
        if (execution.packageSha256 !== args.packageSha256) fail('PACKAGE_CHANGED');
        return execution;
    }
    private async evidence(args: ConnectorExecutionIdentity, supplied: unknown) {
        const execution = await this.context(args);
        const verified = await this.ports.verifyEvidence(args, execution, supplied);
        if (!verified) fail('RECONCILIATION_SOURCE_UNVERIFIED');
        return { execution, result: evaluateVkConnectorReconciliation(execution.binding, execution.body,
            execution.releasedAt, structuredClone(verified), this.now()) };
    }
    private async job(store: ConnectorStore, args: ConnectorExecutionIdentity): Promise<ConnectorJob> {
        await store.authorize(args.projectId, args.actorId, true);
        const job = await store.job(args.projectId, args.jobId), host = await store.host(args.projectId, args.hostId);
        if (!job || !host || host.mode !== 'vk_feed_provider' || job.generation !== args.generation || job.packageSha256 !== args.packageSha256
            || job.hostId !== args.hostId || job.instanceId !== args.instanceId || host.instanceId !== args.instanceId
            || this.now().getTime() - host.heartbeatAt.getTime() > 30_000) fail('FENCED');
        return job;
    }
    private async recorded(args: ConnectorExecutionIdentity): Promise<{ factId: number; publicUrl: string } | null> {
        return this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await store.job(args.projectId, args.jobId);
            if (!job || args.projectId !== 10 || job.taskId !== 1048 || job.generation !== args.generation
                || job.packageSha256 !== args.packageSha256 || job.hostId !== args.hostId || job.instanceId !== args.instanceId) fail('FENCED');
            const current = await store.snapshot(10, 1048);
            if (connectorPackageHash(current.package) !== job.packageSha256) fail('PACKAGE_CHANGED');
            if (!current.factId || !current.publicUrl) return null;
            if (job.state !== 'confirmed') {
                if (!await store.updateJob(job.jobId, job.generation, job.state, { state: 'confirmed', factId: current.factId,
                    attemptId: current.attemptId, blocker: null, updatedAt: this.now() })) fail('CAS_CONFLICT');
                await store.event(10, 1048, args.actorId, 'vk_connector_fact_projection', { jobId: job.jobId,
                    state: 'confirmed', generation: job.generation });
            }
            return { factId: current.factId, publicUrl: current.publicUrl };
        });
    }
    /** Reservation precedes canonical reclaim. A lost post-claim response never resets a lease. */
    async claim(args: ConnectorExecutionIdentity & { evidence: unknown }): Promise<ConnectorExecutionLease> {
        const proof = await this.evidence(args, args.evidence);
        if (proof.result.kind !== 'proven_absence') fail('VERIFICATION_REQUIRED');
        const generation = await this.repository.transaction(async store => {
            const job = await this.job(store, args), snapshot = await store.snapshot(args.projectId, job.taskId);
            if (snapshot.attemptId || snapshot.factId || !snapshot.eligible || !['accepted', 'ready'].includes(job.state)) fail('VERIFICATION_REQUIRED');
            const next = job.generation + 1;
            if (!await store.updateJob(job.jobId, job.generation, job.state, { state: 'reconciling', generation: next,
                canonicalLeaseSha256: null, canonicalLeaseExpiresAt: null, updatedAt: this.now() })) fail('CAS_CONFLICT');
            await store.event(job.projectId, job.taskId, args.actorId, 'vk_connector_lease_reservation', { jobId: job.jobId, generation: next, state: 'reconciling' });
            return next;
        });
        try {
        const lease = await this.ports.claimLease({ projectId: 10, actorId: args.actorId, workItemId: 1699,
            idempotencyKey: `vk-connector-claim:${args.jobId}:g${generation}` });
        if (!lease.leaseToken || Date.parse(lease.leaseExpiresAt) <= this.now().getTime()) fail('LEASE_UNAVAILABLE');
        await this.repository.transaction(async store => {
            const job = await this.job(store, { ...args, generation }), snapshot = await store.snapshot(args.projectId, job.taskId);
            if (snapshot.attemptId || snapshot.factId || !snapshot.eligible) fail('VERIFICATION_REQUIRED');
            if (!store.bindLease) fail('LEASE_UNAVAILABLE');
            await store.bindLease(args.projectId, args.actorId, lease.leaseToken, lease.leaseExpiresAt);
            if (!await store.updateJob(job.jobId, generation, 'reconciling', { state: 'ready',
                canonicalLeaseSha256: connectorHash(lease.leaseToken), canonicalLeaseExpiresAt: new Date(lease.leaseExpiresAt), updatedAt: this.now() })) fail('CAS_CONFLICT');
            await store.event(job.projectId, job.taskId, args.actorId, 'vk_connector_canonical_lease_bound', { jobId: job.jobId, generation, state: 'ready' });
        });
        return { workItemId: 1699, ...lease, generation };
        } catch (error: unknown) {
            await this.repository.transaction(async store => {
                const job = await store.job(args.projectId, args.jobId);
                if (job?.generation === generation && job.state === 'reconciling') {
                    await store.updateJob(job.jobId, generation, 'reconciling', { state: 'verification_required',
                        blocker: 'CANONICAL_LEASE_UNAVAILABLE', updatedAt: this.now() });
                    await store.event(args.projectId, 1048, args.actorId, 'vk_connector_claim_interrupted', {
                        jobId: job.jobId, generation, state: 'verification_required', blocker: 'CANONICAL_LEASE_UNAVAILABLE' });
                }
            });
            throw error;
        }
    }
    async check(args: ConnectorExecutionIdentity & { leaseToken: string }): Promise<{ status: 'validated'; generation: number }> {
        await this.context(args);
        await this.repository.transaction(async store => {
            const job = await this.job(store, args);
            if (!['ready', 'executing', 'reconciling'].includes(job.state) || !job.canonicalLeaseSha256 || !connectorSecretEqual(job.canonicalLeaseSha256, connectorHash(args.leaseToken))
                || !job.canonicalLeaseExpiresAt || job.canonicalLeaseExpiresAt <= this.now()) fail('FENCED');
        });
        await this.ports.checkLease(args);
        return { status: 'validated', generation: args.generation };
    }
    async start(args: ConnectorStartArgs) {
        await this.check(args);
        const result = await this.ports.start(args);
        await this.repository.transaction(async store => {
            const job = await this.job(store, args);
            if (result.status === 'started' && !await store.updateJob(job.jobId, job.generation, job.state, {
                state: 'executing', attemptId: result.attempt_id, updatedAt: this.now() })) fail('CAS_CONFLICT');
        });
        return result;
    }
    async confirm(args: ConnectorConfirmArgs) {
        const recorded = await this.recorded(args);
        if (recorded) return { publication_fact_id: recorded.factId, replayed: true };
        const execution = await this.context(args);
        validateVkPostConfirmation(args, String(execution.binding.communityId), this.now());
        const ack = args.mediaAcknowledgement;
        if (ack?.acknowledged !== true || ack.assetSha256 !== execution.binding.assetSha256
            || ack.providerObjectId !== args.providerObjectId || !/^photo-240051152_[1-9]\d*$/.test(ack.providerMediaId)) fail('MEDIA_UNCONFIRMED');
        if (!await this.ports.verifyMediaAcknowledgement(args, execution)) fail('MEDIA_SOURCE_UNVERIFIED');
        await this.check(args);
        const result = await this.ports.confirm(args);
        await this.dispatch.reconcile({ projectId: args.projectId, actorId: args.actorId, jobId: args.jobId });
        return result;
    }
    async uncertain(args: ConnectorUncertainArgs) {
        await this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await store.job(args.projectId, args.jobId);
            if (!job || args.projectId !== 10 || job.generation !== args.generation || job.packageSha256 !== args.packageSha256
                || job.hostId !== args.hostId || job.instanceId !== args.instanceId
                || job.attemptId !== args.attemptId || !['executing', 'verification_required'].includes(job.state)) fail('FENCED');
        });
        return this.ports.uncertain(args);
    }
    async reconcile(args: ConnectorExecutionIdentity & { evidence: unknown }) {
        const recorded = await this.recorded(args);
        if (recorded) return { kind: 'exact_match' as const, ...recorded };
        const proof = await this.evidence(args, args.evidence);
        if (proof.result.kind !== 'exact_match') return proof.result;
        const fact = await this.ports.recordMatchedFact(args, proof.execution, proof.result.post);
        await this.dispatch.reconcile({ projectId: args.projectId, actorId: args.actorId, jobId: args.jobId });
        return { kind: 'exact_match' as const, ...fact };
    }
}
