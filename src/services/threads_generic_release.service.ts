import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import threadsService from './threads.service';
import publicationFactService from './publication_fact.service';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { assertThreadsOwnerRelease } from './threads_release_diagnostics';

const RELEASE_COMMAND = 'ba_release_approved_threads_task';
const SEND_COMMAND = 'ba_publish_threads_task';
const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

export type GenericThreadsReleaseArgs = {
    projectId: number; taskId: number; actorId: string; approvalReference: string;
    expectedManifestChecksum: string; expectedAcceptedRevision: number; expectedContentRevision: number;
    expectedBodySha256: string; expectedChannelId: number; expectedScheduleAt: string;
    expectedVisualState: 'NO_VISUAL_NEEDED'; expectedSelectedAssetId: null; expectedPlacement: 'feed';
    expectedThreadsUserId: string; expectedUsername: string; idempotencyKey: string;
};

export type GenericThreadsPublishArgs = {
    projectId: number; taskId: number; actorId: string; approvalReference: string;
    expectedManifestChecksum: string; releaseIdempotencyKey: string; idempotencyKey: string; dryRun?: boolean;
};

type Database = typeof prisma;
type Deps = { db: Database; threads: typeof threadsService; facts: typeof publicationFactService;
    manifest: typeof loadAgentWorkspaceManifest; now(): number };

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function object(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function ownerId(actorId: string) {
    const match = /^user:([1-9]\d*)$/.exec(actorId);
    if (!match) throw new Error('[THREADS_OWNER_REQUIRED]');
    return Number(match[1]);
}
function releaseRequestHash(a: GenericThreadsReleaseArgs) { return hash(JSON.stringify(a)); }
function sendRequestHash(a: GenericThreadsPublishArgs) {
    return hash(JSON.stringify({ ...a, dryRun: false }));
}

export class GenericThreadsReleaseService {
    constructor(private readonly deps: Deps) {}

    private async manifest(tx: Prisma.TransactionClient, projectId: number, actorId: string, expected: string) {
        const userId = ownerId(actorId);
        const member = await tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } });
        if (member?.role !== 'owner') throw new Error('[THREADS_OWNER_REQUIRED]');
        const manifest = await this.deps.manifest(projectId, userId, tx);
        if (manifest.project.id !== 10 || manifest.project.slug !== 'analystcraft-2' || manifest.checksum !== expected) {
            throw new Error('[MCP_PROJECT_SCOPE_MISMATCH]');
        }
        return manifest;
    }

    private async inspect(tx: Prisma.TransactionClient, projectId: number, taskId: number, actorId: string,
        expectedManifestChecksum: string, expectedMode: 'approval_required' | 'owner_released', attemptId?: number) {
        const manifest = await this.manifest(tx, projectId, actorId, expectedManifestChecksum);
        const task = await tx.contentItem.findFirst({ where: { id: taskId, project_id: projectId },
            include: { channel: true, publication_fact: true, selected_asset: true } });
        if (!task || task.channel?.type !== 'threads') throw new Error('[THREADS_TASK_MISMATCH]');
        const [decision, review, art, firstAttempt, browserWork] = await Promise.all([
            tx.artDirectionDecision.findFirst({ where: { project_id: projectId, content_item_id: taskId,
                source_content_revision: task.content_revision, placement: 'feed', status: 'active' }, orderBy: { id: 'desc' } }),
            tx.workItem.findFirst({ where: { project_id: projectId, content_item_id: taskId, kind: 'content_review',
                state: 'completed', input_context_version: task.content_revision }, orderBy: { id: 'desc' } }),
            tx.workItem.findFirst({ where: { project_id: projectId, content_item_id: taskId, kind: 'art_direction',
                state: 'completed', input_context_version: task.content_revision }, orderBy: { id: 'desc' } }),
            tx.deliveryAttempt.findFirst({ where: { project_id: projectId, content_item_id: taskId }, orderBy: { id: 'asc' } }),
            tx.workItem.findFirst({ where: { project_id: projectId, content_item_id: taskId, kind: 'browser_publish',
                state: { notIn: ['completed', 'cancelled'] } } })
        ]);
        const config = resolveEffectiveChannelConfig('threads', task.channel.config || {});
        const body = task.draft_text || '';
        const baseValid = task.channel.is_active && task.text_state === 'accepted'
            && task.accepted_revision === task.content_revision && body.trim().length > 0 && body.length <= 500
            && task.visual_state === 'NO_VISUAL_NEEDED' && task.selected_asset_id === null && !task.selected_asset
            && task.visual_placement === 'feed' && task.visual_mode !== 'required'
            && decision?.decision === 'NO_VISUAL_NEEDED' && decision.channel === 'threads'
            && decision.source_content_revision === task.content_revision
            && decision.decision_version === task.visual_decision_version
            && Boolean(review) && Boolean(art) && task.handoff_state === 'ready'
            && task.publication_mode === expectedMode && task.status === (attemptId ? 'publishing' : 'ready_for_execution')
            && !task.publication_fact && !task.published_link && !browserWork
            && (attemptId ? firstAttempt?.id === attemptId && firstAttempt.status === 'pending' : !firstAttempt)
            && !object(task.quality_report).publication_hold;
        if (!baseValid) throw new Error('[THREADS_GENERIC_PACKAGE_GUARD_FAILED]');
        if (!config.access_token || !config.threads_user_id) throw new Error('[THREADS_CONNECTOR_NOT_READY]');
        return { manifest, task, decision, config, body, bodySha256: hash(body) };
    }

    private async providerPreflight(config: Record<string, any>, bodySha256: string, expectedUserId: string, expectedUsername: string) {
        const token = String(config.access_token);
        const identity = await this.deps.threads.testConnection({ access_token: token, threads_user_id: expectedUserId });
        if (!identity.success || identity.details?.id !== expectedUserId || identity.details.username !== expectedUsername) {
            throw new Error('[THREADS_PROVIDER_IDENTITY_UNVERIFIED]');
        }
        let after: string | undefined;
        const signal = AbortSignal.timeout(30_000);
        for (let page = 0; page < 5; page += 1) {
            const posts = await this.deps.threads.getOwnPosts(token, expectedUserId, after, signal);
            if (posts.items.some(post => typeof post.text === 'string' && hash(post.text) === bodySha256)) {
                throw new Error('[THREADS_DUPLICATE_FOUND]');
            }
            if (!posts.after) return;
            if (posts.after === after) break;
            after = posts.after;
        }
        throw new Error('[THREADS_HISTORY_INCOMPLETE]');
    }

    async release(a: GenericThreadsReleaseArgs) {
        const prior = await this.deps.db.$transaction(async tx => {
            await this.manifest(tx, a.projectId, a.actorId, a.expectedManifestChecksum);
            return tx.workflowEvent.findFirst({ where: { project_id: a.projectId,
                content_item_id: a.taskId, actor_id: a.actorId, command: RELEASE_COMMAND, idempotency_key: a.idempotencyKey } });
        }, serial);
        if (prior) {
            if (object(prior.before_state).request_hash !== releaseRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return object(prior.after_state);
        }
        const checked = await this.deps.db.$transaction(tx => this.inspect(tx, a.projectId, a.taskId, a.actorId,
            a.expectedManifestChecksum, 'approval_required'), serial);
        const schedule = checked.task.schedule_at?.toISOString() || null;
        const username = String(checked.config.channel_username || checked.config.account_ref || '').replace(/^@/, '');
        if (a.projectId !== 10 || checked.task.channel_id !== a.expectedChannelId
            || checked.task.content_revision !== a.expectedContentRevision || checked.task.accepted_revision !== a.expectedAcceptedRevision
            || checked.bodySha256 !== a.expectedBodySha256 || schedule !== a.expectedScheduleAt
            || checked.task.publish_at?.toISOString() !== a.expectedScheduleAt
            || a.expectedVisualState !== 'NO_VISUAL_NEEDED' || a.expectedSelectedAssetId !== null || a.expectedPlacement !== 'feed'
            || checked.config.threads_user_id !== a.expectedThreadsUserId || username !== a.expectedUsername) {
            throw new Error('[THREADS_GENERIC_EXPECTATION_MISMATCH]');
        }
        await this.providerPreflight(checked.config, checked.bodySha256, a.expectedThreadsUserId, a.expectedUsername);
        return this.deps.db.$transaction(async tx => {
            const replay = await tx.workflowEvent.findFirst({ where: { project_id: a.projectId, content_item_id: a.taskId,
                actor_id: a.actorId, command: RELEASE_COMMAND, idempotency_key: a.idempotencyKey } });
            if (replay) return object(replay.after_state);
            const current = await this.inspect(tx, a.projectId, a.taskId, a.actorId, a.expectedManifestChecksum, 'approval_required');
            if (current.bodySha256 !== a.expectedBodySha256 || current.task.updated_at.getTime() !== checked.task.updated_at.getTime()) {
                throw new Error('[THREADS_GENERIC_CAS_CONFLICT]');
            }
            const changed = await tx.contentItem.updateMany({ where: { id: a.taskId, project_id: a.projectId,
                updated_at: current.task.updated_at, publication_mode: 'approval_required', status: 'ready_for_execution' },
            data: { publication_mode: 'owner_released' } });
            if (changed.count !== 1) throw new Error('[THREADS_GENERIC_CAS_CONFLICT]');
            const proof = { publication_authorized: true, task_id: a.taskId, channel_id: a.expectedChannelId,
                accepted_revision: a.expectedAcceptedRevision, content_revision: a.expectedContentRevision,
                body_sha256: a.expectedBodySha256, manifest_checksum: a.expectedManifestChecksum,
                threads_user_id: a.expectedThreadsUserId, username: a.expectedUsername,
                schedule_at: a.expectedScheduleAt, publish_at: current.task.publish_at?.toISOString() || null,
                visual_state: 'NO_VISUAL_NEEDED', selected_asset_id: null, placement: 'feed',
                decision_id: current.decision?.id, actor_id: a.actorId, release_idempotency_key: a.idempotencyKey };
            await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                actor_id: a.actorId, command: RELEASE_COMMAND, idempotency_key: a.idempotencyKey,
                before_state: { request_hash: releaseRequestHash(a), approval_reference: a.approvalReference,
                    manifest_checksum: a.expectedManifestChecksum }, after_state: proof } });
            return proof;
        }, serial);
    }

    async publish(a: GenericThreadsPublishArgs) {
        const prior = await this.deps.db.$transaction(async tx => {
            await this.manifest(tx, a.projectId, a.actorId, a.expectedManifestChecksum);
            return tx.workflowEvent.findFirst({ where: { project_id: a.projectId,
                content_item_id: a.taskId, actor_id: a.actorId, command: SEND_COMMAND, idempotency_key: a.idempotencyKey } });
        }, serial);
        if (prior) {
            if (object(prior.before_state).request_hash !== sendRequestHash(a)) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return object(prior.after_state);
        }
        const checked = await this.deps.db.$transaction(tx => this.inspect(tx, a.projectId, a.taskId, a.actorId,
            a.expectedManifestChecksum, 'owner_released'), serial);
        const release = await this.deps.db.workflowEvent.findFirst({ where: { project_id: a.projectId,
            content_item_id: a.taskId, actor_id: a.actorId, command: RELEASE_COMMAND,
            idempotency_key: a.releaseIdempotencyKey }, orderBy: { id: 'desc' } });
        const proof = assertThreadsOwnerRelease(release, { body_sha256: checked.bodySha256,
            channel_id: checked.task.channel_id, accepted_revision: checked.task.accepted_revision,
            manifest_checksum: a.expectedManifestChecksum, actor_id: a.actorId, approval_reference: a.approvalReference });
        if (a.dryRun) return { mode: 'dry_run', task_id: a.taskId, channel_id: checked.task.channel_id,
            live_publish_supported: true, route_executable: true, accepted_revision: checked.task.accepted_revision,
            selected_asset_id: null, delivery_method: 'threads_api', published: false };
        const dueAt = checked.task.publish_at || checked.task.schedule_at;
        if (!dueAt || this.deps.now() < dueAt.getTime()) throw new Error('[THREADS_NOT_DUE]');
        await this.providerPreflight(checked.config, checked.bodySha256, String(proof.threads_user_id), String(proof.username));
        const claim = await this.deps.db.$transaction(async tx => {
            const current = await this.inspect(tx, a.projectId, a.taskId, a.actorId, a.expectedManifestChecksum, 'owner_released');
            const changed = await tx.contentItem.updateMany({ where: { id: a.taskId, project_id: a.projectId,
                updated_at: current.task.updated_at, status: 'ready_for_execution', publication_mode: 'owner_released' },
            data: { status: 'publishing' } });
            if (changed.count !== 1) throw new Error('[THREADS_PUBLICATION_ALREADY_CLAIMED]');
            const attempt = await tx.deliveryAttempt.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                channel_id: current.task.channel_id!, mode: 'automatic', status: 'pending', attempt_number: 1,
                idempotency_key: a.idempotencyKey, scheduled_at: current.task.schedule_at, requires_manual_confirmation: true } });
            await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                actor_id: a.actorId, command: `${SEND_COMMAND}:claim`, idempotency_key: a.idempotencyKey,
                before_state: { request_hash: sendRequestHash(a), approval_reference: a.approvalReference },
                after_state: { attempt_id: attempt.id } } });
            return { attemptId: attempt.id, body: current.body, token: String(current.config.access_token),
                userId: String(proof.threads_user_id), username: String(proof.username) };
        }, serial);
        let result: { id: string; url: string; publishedAt: string };
        try {
            const dispatch = await this.deps.db.$transaction(tx => this.inspect(tx, a.projectId, a.taskId,
                a.actorId, a.expectedManifestChecksum, 'owner_released', claim.attemptId), serial);
            if (String(dispatch.config.access_token) !== claim.token
                || String(dispatch.config.threads_user_id) !== claim.userId
                || dispatch.body !== claim.body) throw new Error('[THREADS_DISPATCH_GUARD_FAILED]');
            result = await this.deps.threads.publishVerifiedText(claim.userId, claim.token, claim.body, claim.username);
        } catch {
            await this.deps.db.$transaction(async tx => {
                await tx.deliveryAttempt.updateMany({ where: { id: claim.attemptId, project_id: a.projectId,
                    content_item_id: a.taskId, status: 'pending', idempotency_key: a.idempotencyKey },
                data: { requires_manual_confirmation: true, error_message: 'THREADS_OUTCOME_UNCERTAIN_RECONCILE_ONLY' } });
                await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                    actor_id: a.actorId, command: `${SEND_COMMAND}:uncertain`, idempotency_key: a.idempotencyKey,
                    before_state: { request_hash: sendRequestHash(a) },
                    after_state: { attempt_id: claim.attemptId, retry_allowed: false } } });
            }, serial);
            throw new Error('[THREADS_PUBLICATION_UNCERTAIN] Reconcile before retry');
        }
        const response = { mode: 'published', task_id: a.taskId, provider_object_id: result.id,
            public_url: result.url, published_at: result.publishedAt, retry_allowed: false };
        await this.deps.facts.record({ projectId: a.projectId, taskId: a.taskId, actorId: a.actorId,
            artifactKind: 'post', outcome: 'published', confirmationMode: 'automatic', publishedAt: result.publishedAt,
            publicUrl: result.url, providerObjectId: result.id, evidence: { type: 'api', ref: result.id },
            beforeWrite: async tx => {
                const current = await this.inspect(tx, a.projectId, a.taskId, a.actorId, a.expectedManifestChecksum, 'owner_released', claim.attemptId);
                if (current.bodySha256 !== checked.bodySha256) throw new Error('[THREADS_GENERIC_PACKAGE_CHANGED]');
                const updated = await tx.deliveryAttempt.updateMany({ where: { id: claim.attemptId,
                    project_id: a.projectId, content_item_id: a.taskId, status: 'pending', idempotency_key: a.idempotencyKey },
                data: { status: 'delivered', actual_published_at: new Date(result.publishedAt), requires_manual_confirmation: false } });
                if (updated.count !== 1) throw new Error('[THREADS_ATTEMPT_CONFLICT]');
                await tx.workflowEvent.create({ data: { project_id: a.projectId, content_item_id: a.taskId,
                    actor_id: a.actorId, command: SEND_COMMAND, idempotency_key: a.idempotencyKey,
                    before_state: { request_hash: sendRequestHash(a), approval_reference: a.approvalReference },
                    after_state: response } });
            } });
        return response;
    }
}

export default new GenericThreadsReleaseService({ db: prisma, threads: threadsService,
    facts: publicationFactService, manifest: loadAgentWorkspaceManifest, now: () => Date.now() });
