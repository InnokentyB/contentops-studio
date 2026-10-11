import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import threadsService from './threads.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

const hashBody = (body: string) => createHash('sha256').update(body).digest('hex');

export const THREADS1051_SPEC = {
    projectId: 10,
    taskId: 1051,
    channelId: 138,
    revision: 2,
    bodySha256: 'd96eba545e5062bb339fef56c7e0ef7de39807c7892c7c46d461ef2c02b24d5e',
    decisionId: 282,
    decisionVersion: 2,
    schedule: '2026-10-11T16:30:00.000Z',
    threadsUserId: '39421253764155091',
    username: 'innokentybo',
    manifestChecksum: 'sha256:6ceb5c1c2199d8c1915beeb622a9791ff9c1b877d02649c8e69acd0d173e46d8',
    releaseCommand: 'ba_release_threads_task1051_recovery',
    hashBody
} as const;

export type Threads1051ReleaseArgs = {
    projectId: 10;
    taskId: 1051;
    actorId: string;
    expectedManifestChecksum: typeof THREADS1051_SPEC.manifestChecksum;
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
    hashBody,
    now: () => new Date()
};

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function hasUncertainResult(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasUncertainResult);
    if (value === 'provider_result_uncertain') return true;
    const item = record(value);
    return Object.values(item).some(hasUncertainResult);
}

function requestHash(args: Threads1051ReleaseArgs): string {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

/** Owner-only exact release of task1051; records proof and never contacts the publish endpoint. */
export async function releaseThreadsTask1051(args: Threads1051ReleaseArgs,
    deps: Dependencies = dependencies): Promise<Record<string, unknown>> {
    const actor = /^user:(\d+)$/.exec(args.actorId);
    if (!actor || args.projectId !== 10 || args.taskId !== 1051
        || args.expectedManifestChecksum !== THREADS1051_SPEC.manifestChecksum
        || !args.approvalReference.trim() || !args.idempotencyKey.trim()) {
        throw new Error('[THREADS1051_RELEASE_SCOPE_MISMATCH]');
    }
    const userId = Number(actor[1]);
    const [owner, manifest, channel] = await Promise.all([
        deps.database.projectMember.findUnique({ where: {
            project_id_user_id: { project_id: 10, user_id: userId } } }),
        deps.manifestLoader(10, userId),
        deps.database.socialChannel.findFirst({ where: { id: 138, project_id: 10,
            type: 'threads', name: 'innokenty_threads', is_active: true } })
    ]);
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (manifest.checksum !== THREADS1051_SPEC.manifestChecksum) throw new Error('[STALE_MANIFEST]');
    if (!channel) throw new Error('[THREADS_CHANNEL_NOT_READY]');
    const config = resolveEffectiveChannelConfig('threads', channel.config || {});
    if (!config.access_token || config.threads_user_id !== THREADS1051_SPEC.threadsUserId) {
        throw new Error('[THREADS_IDENTITY_NOT_VERIFIED]');
    }
    const connection = await deps.threads.testConnection(config);
    if (!connection.success || connection.details?.id !== THREADS1051_SPEC.threadsUserId
        || connection.details.username !== THREADS1051_SPEC.username) {
        throw new Error('[THREADS_IDENTITY_NOT_VERIFIED]');
    }
    let after: string | undefined;
    for (let page = 0; page < 5; page += 1) {
        const history = await deps.threads.getOwnPosts(config.access_token, THREADS1051_SPEC.threadsUserId, after);
        if (history.items.some(post => deps.hashBody(post.text || '') === THREADS1051_SPEC.bodySha256)) {
            throw new Error('[THREADS_PROVIDER_DUPLICATE_FOUND] Reconcile the existing provider post');
        }
        if (!history.after) break;
        if (page === 4) throw new Error('[THREADS_HISTORY_INCOMPLETE]');
        after = history.after;
    }

    const hash = requestHash(args);
    return deps.database.$transaction(async tx => {
        const [currentOwner, replay, task, attempt, browserWork, decision] = await Promise.all([
            tx.projectMember.findUnique({ where: { project_id_user_id: { project_id: 10, user_id: userId } } }),
            tx.workflowEvent.findFirst({ where: { project_id: 10, content_item_id: 1051,
                actor_id: args.actorId, command: THREADS1051_SPEC.releaseCommand,
                idempotency_key: args.idempotencyKey } }),
            tx.contentItem.findFirst({ where: { id: 1051, project_id: 10 },
                include: { channel: true, selected_asset: true, publication_fact: true } }),
            tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1051 } }),
            tx.workItem.findFirst({ where: { project_id: 10, content_item_id: 1051,
                kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } }),
            tx.artDirectionDecision.findFirst({ where: { id: 282, project_id: 10,
                content_item_id: 1051, source_content_revision: 2, decision_version: 2,
                decision: 'NO_VISUAL_NEEDED', channel: 'threads', placement: 'feed', status: 'active' } })
        ]);
        if (currentOwner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        if (replay?.after_state) {
            if (record(replay.before_state).request_hash !== hash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            return { ...record(replay.after_state), replayed: true };
        }
        if (attempt) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        if (browserWork) throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');
        if (task?.publication_fact || task?.published_link) throw new Error('[PUBLICATION_FACT_EXISTS]');
        if (task && hasUncertainResult(task.quality_report)) throw new Error('[UNCERTAIN_ATTEMPT_EXISTS]');
        if (!task || !decision || task.channel_id !== 138 || task.channel?.name !== 'innokenty_threads'
            || task.channel.type !== 'threads' || task.channel.is_active !== true
            || task.status !== 'ready_for_execution' || task.publication_mode !== 'approval_required'
            || task.handoff_state !== 'ready' || task.content_revision !== 2 || task.accepted_revision !== 2
            || task.text_state !== 'accepted' || deps.hashBody(task.draft_text || '') !== THREADS1051_SPEC.bodySha256
            || !task.draft_text || task.draft_text.length > 500 || task.visual_state !== 'NO_VISUAL_NEEDED'
            || task.visual_placement !== 'feed' || task.visual_decision_version !== 2
            || task.selected_asset_id !== null || task.selected_asset !== null
            || task.schedule_at?.toISOString() !== THREADS1051_SPEC.schedule
            || task.publish_at?.toISOString() !== THREADS1051_SPEC.schedule || task.telegram_message_id) {
            throw new Error('[THREADS1051_PACKAGE_CHANGED]');
        }
        const proof = { publication_authorized: true, actor_id: args.actorId,
            approval_reference: args.approvalReference, manifest_checksum: manifest.checksum,
            task_id: 1051, channel_id: 138, threads_user_id: THREADS1051_SPEC.threadsUserId,
            username: THREADS1051_SPEC.username, content_revision: 2, accepted_revision: 2,
            body_sha256: THREADS1051_SPEC.bodySha256, visual_decision_id: 282,
            visual_decision_version: 2, selected_asset_id: null, asset_sha256: null,
            schedule_at: THREADS1051_SPEC.schedule, publish_at: THREADS1051_SPEC.schedule,
            released_at: deps.now().toISOString() };
        const changed = await tx.contentItem.updateMany({ where: { id: 1051, project_id: 10,
            channel_id: 138, status: 'ready_for_execution', publication_mode: 'approval_required',
            content_revision: 2, accepted_revision: 2, selected_asset_id: null,
            schedule_at: new Date(THREADS1051_SPEC.schedule), publish_at: new Date(THREADS1051_SPEC.schedule) },
        data: { publication_mode: 'owner_released', quality_report: {
            ...record(task.quality_report), publication_route: 'threads_api', owner_release: proof,
            recovery_release: proof } as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new Error('[THREADS1051_RELEASE_CAS_CONFLICT]');
        const result = { ...proof, publication_mode: 'owner_released', published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1051,
            actor_id: args.actorId, command: THREADS1051_SPEC.releaseCommand,
            idempotency_key: args.idempotencyKey,
            before_state: { request_hash: hash, status: task.status,
                publication_mode: task.publication_mode, manifest_checksum: manifest.checksum },
            after_state: result as Prisma.InputJsonValue } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
