import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import threadsService from './threads.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

export const THREADS1046_MANIFEST_CHECKSUM =
    'sha256:d5970e6b33d5f161a73f6ebc13fb5255f5a24be4f14251e57e5223ea03a2192f';

const SPEC = {
    projectId: 10,
    taskId: 1046,
    channelId: 138,
    revision: 4,
    bodySha256: 'e3403bd77725ff503627cdecca3a2ce423f148af75ac25830add9652ae25adb9',
    decisionId: 270,
    decisionVersion: 1,
    assetId: 132,
    assetSha256: '1b9177bbdc77a4d29f0c950f14f85f16f018c2a45544aa8f75ff6e8f00db2e03',
    schedule: '2026-10-10T16:30:00.000Z',
    threadsUserId: '39421253764155091',
    username: 'innokentybo',
    releaseCommand: 'ba_release_threads_task1046_api'
} as const;

type ReleaseArgs = {
    projectId: 10;
    taskId: 1046;
    actorId: string;
    expectedManifestChecksum: typeof THREADS1046_MANIFEST_CHECKSUM;
    approvalReference: string;
    idempotencyKey: string;
};

type Dependencies = {
    database: typeof prisma;
    manifestLoader: typeof loadAgentWorkspaceManifest;
    threads: Pick<typeof threadsService, 'testConnection' | 'getOwnPosts'>;
    hashBody: (body: string) => string;
    now: () => Date;
};

const dependencies: Dependencies = {
    database: prisma,
    manifestLoader: loadAgentWorkspaceManifest,
    threads: threadsService,
    hashBody: body => createHash('sha256').update(body).digest('hex'),
    now: () => new Date()
};

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

function hasUncertainResult(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasUncertainResult);
    const item = record(value);
    if (!item) return value === 'provider_result_uncertain';
    return Object.values(item).some(hasUncertainResult);
}

function assetChecksum(asset: { provenance?: unknown } | null | undefined) {
    const provenance = record(asset?.provenance);
    const storage = record(provenance?.planner_storage);
    return typeof storage?.sha256 === 'string' ? storage.sha256 : null;
}

function assetIsDurable(asset: { file_url?: string | null; provenance?: unknown } | null | undefined) {
    const provenance = record(asset?.provenance);
    const storage = record(provenance?.planner_storage);
    return storage?.managed === true && typeof asset?.file_url === 'string'
        && /^https:\/\//.test(asset.file_url);
}

function requestHash(args: ReleaseArgs) {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

export async function releaseThreadsTask1046(args: ReleaseArgs, deps: Dependencies = dependencies): Promise<Record<string, unknown>> {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (args.projectId !== SPEC.projectId || args.taskId !== SPEC.taskId) throw new Error('[THREADS1046_SCOPE_MISMATCH]');
    if (!actor || !args.approvalReference?.trim()) throw new Error('[OWNER_APPROVAL_REQUIRED]');
    if (!args.idempotencyKey?.trim()) throw new Error('[IDEMPOTENCY_KEY_REQUIRED]');
    if (args.expectedManifestChecksum !== THREADS1046_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');

    const userId = Number(actor[1]);
    const [owner, manifest, channel] = await Promise.all([
        deps.database.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
        deps.manifestLoader(10, userId),
        deps.database.socialChannel.findFirst({ where: {
            id: SPEC.channelId, project_id: 10, type: 'threads', name: 'innokenty_threads', is_active: true
        } })
    ]);
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== THREADS1046_MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
    if (!channel) throw new Error('[THREADS_CHANNEL_NOT_READY]');

    const config = resolveEffectiveChannelConfig('threads', channel.config || {});
    if (!config.access_token || config.threads_user_id !== SPEC.threadsUserId) {
        throw new Error('[THREADS_IDENTITY_NOT_VERIFIED]');
    }
    const connection = await deps.threads.testConnection(config);
    if (!connection.success || connection.details?.id !== SPEC.threadsUserId
        || connection.details.username !== SPEC.username) throw new Error('[THREADS_IDENTITY_NOT_VERIFIED]');

    let after: string | undefined;
    for (let page = 0; page < 5; page += 1) {
        const history = await deps.threads.getOwnPosts(config.access_token, SPEC.threadsUserId, after);
        if (history.items.some(post => deps.hashBody(post.text || '') === SPEC.bodySha256)) {
            throw new Error('[THREADS_PROVIDER_DUPLICATE_FOUND] Reconcile the existing provider post');
        }
        if (!history.after) break;
        if (page === 4) throw new Error('[THREADS_HISTORY_INCOMPLETE]');
        after = history.after;
    }

    const hash = requestHash(args);
    return deps.database.$transaction(async tx => {
        const currentOwner = await tx.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: 10, user_id: userId }
        } });
        if (currentOwner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: 1046, actor_id: args.actorId,
            command: SPEC.releaseCommand, idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if (record(prior.before_state)?.request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...(record(prior.after_state) || {}), replayed: true };
        }
        const task = await tx.contentItem.findFirst({ where: { id: 1046, project_id: 10 },
            include: { channel: true, selected_asset: true, publication_fact: true } });
        if (task?.publication_fact || task?.published_link) throw new Error('[PUBLICATION_FACT_EXISTS]');
        if (task && hasUncertainResult(task.quality_report)) throw new Error('[UNCERTAIN_ATTEMPT_EXISTS]');
        if (record(task?.quality_report)?.publication_task_delivery) throw new Error('[PRIOR_DELIVERY_STATE_EXISTS]');
        const decision = await tx.artDirectionDecision.findFirst({ where: {
            id: SPEC.decisionId, project_id: 10, content_item_id: 1046,
            source_content_revision: SPEC.revision, decision_version: SPEC.decisionVersion,
            decision: 'GENERATE', channel: 'threads', placement: 'feed', status: 'active'
        } });
        if (!task || task.channel_id !== SPEC.channelId || task.channel?.type !== 'threads'
            || task.channel.name !== 'innokenty_threads' || task.channel.is_active !== true
            || task.status !== 'ready_for_execution' || task.publication_mode !== 'approval_required'
            || task.handoff_state !== 'ready' || task.content_revision !== SPEC.revision
            || task.accepted_revision !== SPEC.revision || task.text_state !== 'accepted'
            || deps.hashBody(task.draft_text || '') !== SPEC.bodySha256
            || !task.draft_text || task.draft_text.length > 500
            || task.visual_state !== 'APPROVED' || task.visual_placement !== 'feed'
            || task.visual_decision_version !== SPEC.decisionVersion || !decision
            || task.selected_asset_id !== SPEC.assetId || task.selected_asset?.id !== SPEC.assetId
            || task.selected_asset.status !== 'approved'
            || task.selected_asset.content_revision !== SPEC.revision
            || !assetIsDurable(task.selected_asset) || assetChecksum(task.selected_asset) !== SPEC.assetSha256
            || task.schedule_at?.toISOString() !== SPEC.schedule || task.publish_at?.toISOString() !== SPEC.schedule
            || task.telegram_message_id) throw new Error('[THREADS1046_PACKAGE_CHANGED]');
        if (await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1046 } })) {
            throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        }
        if (await tx.workItem.findFirst({ where: { project_id: 10, content_item_id: 1046,
            kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })) {
            throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');
        }
        const now = deps.now();
        const proof = {
            publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, manifest_checksum: manifest.checksum,
            task_id: 1046, channel_id: 138, threads_user_id: SPEC.threadsUserId,
            username: SPEC.username, content_revision: 4, accepted_revision: 4,
            body_sha256: SPEC.bodySha256, visual_decision_id: SPEC.decisionId,
            visual_decision_version: SPEC.decisionVersion, selected_asset_id: SPEC.assetId,
            asset_sha256: SPEC.assetSha256, schedule_at: SPEC.schedule,
            publish_at: SPEC.schedule, released_at: now.toISOString()
        };
        const changed = await tx.contentItem.updateMany({ where: {
            id: 1046, project_id: 10, channel_id: 138, status: 'ready_for_execution',
            publication_mode: 'approval_required', content_revision: 4, accepted_revision: 4,
            selected_asset_id: 132, schedule_at: new Date(SPEC.schedule), publish_at: new Date(SPEC.schedule)
        }, data: { status: 'ready_for_execution', publication_mode: 'owner_released', quality_report: {
            ...(record(task.quality_report) || {}), publication_route: 'threads_api',
            owner_release: proof, recovery_release: proof
        } } });
        if (changed.count !== 1) throw new Error('[THREADS1046_RELEASE_CAS_CONFLICT]');
        const result = { ...proof, publication_mode: 'owner_released' as const,
            published: false as const, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1046,
            actor_id: args.actorId, command: SPEC.releaseCommand, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, status: task.status,
                publication_mode: task.publication_mode, manifest_checksum: manifest.checksum },
            after_state: result as Prisma.InputJsonValue
        } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export const THREADS1046_SPEC = SPEC;
