import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { evaluateVkConnectorReconciliation } from './vk_connector_reconciliation';
import { verifyVkConnectorOriginalPhoto, type VkConnectorOriginalPhotoProof, type VkConnectorPhotoVerification } from './vk_connector_photo_proof';
import { connectorHash, connectorSecretEqual, type ConnectorRepository } from './vk_connector_contract';
import { VkConnectorDispatchService } from './vk_connector_dispatch.service';
import type { ConnectorExecutionIdentity, ConnectorConfirmArgs } from './vk_connector_execution_contract';
import type { ConnectorExecutionPackage } from './vk_connector_contract';

export type VkConnectorChallengePurpose = 'wall_read' | 'submission' | 'post_confirm';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const objectId = z.string().regex(/^-240051152_[1-9]\d*$/);
const photoSource = z.object({ originalUrl: z.url().max(8192), capturedAt: z.iso.datetime(),
    postObjectId: objectId, providerMediaId: z.string().regex(/^photo-240051152_[1-9]\d*$/) }).strict();
const media = z.object({ assetSha256: hash, providerMediaId: z.string().regex(/^photo-240051152_[1-9]\d*$/),
    acknowledged: z.boolean(), source: photoSource.optional() }).strict();
const wall = z.object({ ownerId: z.literal('-240051152'), startedAt: z.iso.datetime(), capturedAt: z.iso.datetime(),
    windowStart: z.iso.datetime(), windowEnd: z.iso.datetime(), coverage: z.enum(['complete_window','partial']),
    exhausted: z.boolean(), rows: z.array(z.object({ objectId, publicUrl: z.url(), publishedAt: z.iso.datetime(),
        text: z.string().max(100_000), media: media.nullable() }).strict()).max(100) }).strict();
const confirmation = z.object({ providerObjectId: objectId, publicUrl: z.url(), publishedAt: z.iso.datetime(),
    evidenceSha256: hash, providerTimestampSource: z.literal('provider'), postBaselineCapturedAt: z.iso.datetime(),
    postBaselineObjectIds: z.array(objectId).max(100), postSubmissionStartedAt: z.iso.datetime(), readbackObservedAt: z.iso.datetime(),
    mediaAcknowledgement: media.omit({ source: true }).extend({ acknowledged: z.literal(true), providerObjectId: objectId }).strict(),
    mediaSource: photoSource }).strict();
const envelope = z.object({ challengeId: z.uuid(), nonce: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.enum(['wall_read','post_confirm']), proof: z.unknown() }).strict();
type Challenge = { identity: ConnectorExecutionIdentity; purpose: VkConnectorChallengePurpose; nonceSha256: string;
    issuedAt: number; expiresAt: number; consumed: boolean };
function scope(identity: ConnectorExecutionIdentity): string {
    return JSON.stringify([identity.projectId, identity.actorId, identity.hostId, identity.instanceId,
        identity.jobId, identity.generation, identity.packageSha256]);
}
function fail(code: string): never { throw new Error(`[VK_CONNECTOR_${code}]`); }

/** App authorization trusts the existing authenticated managed host. It is not platform/tool-policy clearance.
 * Challenges and proofs are process-local: restart invalidates them; no new persisted credential is created.
 */
export class VkConnectorAppAuthority {
    private readonly challenges = new Map<string, Challenge>();
    constructor(private readonly dispatch: VkConnectorDispatchService, private readonly repository: ConnectorRepository,
        private readonly now = () => new Date(),
        private readonly verifyPhoto: (source: VkConnectorOriginalPhotoProof, hash: string) => Promise<VkConnectorPhotoVerification> = verifyVkConnectorOriginalPhoto) {}
    private prune(): void {
        const now = this.now().getTime();
        for (const [id, challenge] of this.challenges) if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
    async issue(args: ConnectorExecutionIdentity & { purpose: VkConnectorChallengePurpose }) {
        await this.dispatch.executionPackage(args);
        await this.repository.transaction(async store => {
            await store.authorize(args.projectId, args.actorId, true);
            const job = await store.job(args.projectId, args.jobId), host = await store.host(args.projectId, args.hostId);
            if (!job || !host || host.mode !== 'vk_feed_provider' || host.instanceId !== args.instanceId
                || job.generation !== args.generation || job.packageSha256 !== args.packageSha256
                || job.instanceId !== args.instanceId || job.hostId !== args.hostId
                || this.now().getTime() - host.heartbeatAt.getTime() > 30_000) fail('FENCED');
            if (args.purpose === 'submission' && (!['ready','executing'].includes(job.state)
                || !job.canonicalLeaseSha256 || !job.canonicalLeaseExpiresAt || job.canonicalLeaseExpiresAt <= this.now())) fail('RECONCILIATION_ONLY');
            if (args.purpose === 'post_confirm' && (job.state !== 'executing' || !job.attemptId)) fail('VERIFICATION_REQUIRED');
        });
        this.prune();
        if (this.challenges.size >= 256) fail('CHALLENGE_CAPACITY');
        const challengeId = randomUUID(), nonce = randomBytes(32).toString('hex'), issuedAt = this.now().getTime();
        const identity = { projectId: args.projectId, actorId: args.actorId, hostId: args.hostId, instanceId: args.instanceId,
            jobId: args.jobId, generation: args.generation, packageSha256: args.packageSha256 };
        this.challenges.set(challengeId, { identity, purpose: args.purpose, nonceSha256: connectorHash(nonce),
            issuedAt, expiresAt: issuedAt + 120_000, consumed: false });
        return { challengeId, nonce, purpose: args.purpose, authorization: 'application_host' as const,
            issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(issuedAt + 120_000).toISOString() };
    }
    async admission(identity?: ConnectorExecutionIdentity, purpose: VkConnectorChallengePurpose = 'wall_read'):
        Promise<'NOT_CHECKED' | 'PERMITTED'> {
        this.prune();
        return identity && [...this.challenges.values()].some(c => scope(c.identity) === scope(identity) && c.purpose === purpose)
            ? 'PERMITTED' : 'NOT_CHECKED';
    }
    revoke(identity: ConnectorExecutionIdentity): void {
        for (const [id, challenge] of this.challenges) if (scope(challenge.identity) === scope(identity)) this.challenges.delete(id);
    }
    private consume(identity: ConnectorExecutionIdentity, supplied: unknown, purpose: 'wall_read' | 'post_confirm') {
        this.prune();
        const parsed = envelope.safeParse(supplied);
        if (!parsed.success || parsed.data.operation !== purpose) return null;
        const challenge = this.challenges.get(parsed.data.challengeId);
        if (!challenge || challenge.consumed || challenge.purpose !== purpose || scope(challenge.identity) !== scope(identity)
            || !connectorSecretEqual(challenge.nonceSha256, connectorHash(parsed.data.nonce))) return null;
        challenge.consumed = true;
        return { challenge, proof: parsed.data.proof };
    }
    async verifyEvidence(identity: ConnectorExecutionIdentity, execution: ConnectorExecutionPackage, supplied: unknown) {
        const consumed = this.consume(identity, supplied, 'wall_read');
        if (!consumed || execution.packageSha256 !== identity.packageSha256) return null;
        const parsed = wall.safeParse(consumed.proof);
        if (!parsed.success || Date.parse(parsed.data.startedAt) < consumed.challenge.issuedAt
            || Date.parse(parsed.data.capturedAt) > this.now().getTime()) return null;
        const result = evaluateVkConnectorReconciliation(execution.binding, execution.body, execution.releasedAt, parsed.data, this.now());
        if (result.kind === 'exact_match') {
            const row = parsed.data.rows.find(post => post.objectId === result.post.objectId), source = row?.media?.source;
            if (!source || source.postObjectId !== result.post.objectId || source.providerMediaId !== result.post.media?.providerMediaId
                || Date.parse(source.capturedAt) < consumed.challenge.issuedAt || Date.parse(source.capturedAt) > this.now().getTime()
                || !(await this.verifyPhoto(source, execution.binding.assetSha256)).verified) return null;
        }
        if (this.now().getTime() >= consumed.challenge.expiresAt) return null;
        return structuredClone(parsed.data);
    }
    async verifyMediaAcknowledgement(args: ConnectorConfirmArgs, execution: ConnectorExecutionPackage): Promise<boolean> {
        const consumed = this.consume(args, args.providerAttestation, 'post_confirm');
        if (!consumed || execution.packageSha256 !== args.packageSha256) return false;
        const proof = confirmation.safeParse(consumed.proof);
        const actual = confirmation.omit({ mediaSource: true }).safeParse({ providerObjectId: args.providerObjectId, publicUrl: args.publicUrl,
            publishedAt: args.publishedAt, evidenceSha256: args.evidenceSha256, providerTimestampSource: args.providerTimestampSource,
            postBaselineCapturedAt: args.postBaselineCapturedAt, postBaselineObjectIds: args.postBaselineObjectIds,
            postSubmissionStartedAt: args.postSubmissionStartedAt, readbackObservedAt: args.readbackObservedAt,
            mediaAcknowledgement: args.mediaAcknowledgement });
        if (!proof.success || !actual.success) return false;
        const { mediaSource, ...providerProof } = proof.data;
        if (mediaSource.postObjectId !== proof.data.providerObjectId || mediaSource.providerMediaId !== proof.data.mediaAcknowledgement.providerMediaId
            || Date.parse(mediaSource.capturedAt) < consumed.challenge.issuedAt || Date.parse(mediaSource.capturedAt) > this.now().getTime()
            || !(await this.verifyPhoto(mediaSource, execution.binding.assetSha256)).verified) return false;
        return this.now().getTime() < consumed.challenge.expiresAt && proof.success && actual.success && proof.data.mediaAcknowledgement.assetSha256 === execution.binding.assetSha256
            && proof.data.mediaAcknowledgement.providerObjectId === proof.data.providerObjectId
            && Date.parse(proof.data.readbackObservedAt) >= consumed.challenge.issuedAt
            && Date.parse(proof.data.readbackObservedAt) <= this.now().getTime()
            && connectorSecretEqual(connectorHash(JSON.stringify(providerProof)), connectorHash(JSON.stringify(actual.data)));
    }
}
