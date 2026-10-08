import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import threadsService from './threads.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';

export const PENDING_THREADS_PACKAGES = {
    1040: { revision: 4, decisionId: 256, decisionChannel: 'threads', chain: false,
        bodySha256: '6c7e36761a0f7cf48859f8f9ef673f3aa38105fa61c10d4ea592cbbeddc60353',
        releaseCommand: 'ba_release_approved_threads_task1040', schedule: '2026-10-08T16:30:00.000Z' },
    1021: { revision: 1, decisionId: 197, decisionChannel: 'threads', chain: false,
        bodySha256: 'f505415d56f83b199ae501ac825694cff849331bf29849b672ea89f732fa9e6b',
        releaseCommand: 'ba_release_approved_threads_task1021', schedule: '2026-10-04T16:30:00.000Z' },
    1026: { revision: 1, decisionId: 231, decisionChannel: 'threads', chain: false,
        bodySha256: '8e7fba9f35b5ea6fef5c27b1a206cf2b0e7ce1afa98e9a949ba1586628f41605',
        releaseCommand: 'ba_release_approved_threads_task1026', schedule: '2026-10-05T16:30:00.000Z' },
    1035: { revision: 1, decisionId: 244, decisionChannel: 'threads', chain: false,
        bodySha256: 'f5b3c7e3e23f355d2e478cd2c7436da3a31cf64ae3a8b6a3aa2fc4cfa1a82d41',
        releaseCommand: 'ba_release_approved_threads_task1035', schedule: '2026-10-07T16:30:00.000Z' }
} as const;

/** Releases only fixed owner-approved Threads packages after identity/history verification. */
export async function releasePendingThreadsTask(args: {
    projectId: number; taskId: number; actorId: string; approvalReference: string; idempotencyKey: string;
    expectedManifestChecksum?: string; newScheduleAt?: string;
}, dependencies = { database: prisma, threads: threadsService, manifestLoader: loadAgentWorkspaceManifest,
    hashBody: (body: string) => createHash('sha256').update(body).digest('hex') }) {
    const { database, threads, manifestLoader, hashBody } = dependencies;
    const spec = PENDING_THREADS_PACKAGES[args.taskId as keyof typeof PENDING_THREADS_PACKAGES];
    if (args.projectId !== 10 || !spec) throw new Error('[THREADS_PENDING_SCOPE_MISMATCH]');
    const match = /^user:(\d+)$/.exec(args.actorId);
    if (!match || !args.approvalReference?.trim() || !args.idempotencyKey?.trim()) throw new Error('[OWNER_APPROVAL_REQUIRED]');
    const owner = await database.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: 10, user_id: Number(match[1])
    } } });
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    if (args.taskId === 1035 || args.taskId === 1040) {
        const manifest = await manifestLoader(10, Number(match[1]));
        const expected = args.taskId === 1040 ? args.expectedManifestChecksum
            : 'sha256:e7f837d363d88c6a30c5e5daac002894f85ccd7e73249fa45ef07d7efc27e46f';
        if (!expected || manifest.checksum !== expected) {
            throw new Error('[STALE_MANIFEST]');
        }
    }
    const channel = await database.socialChannel.findFirst({ where: {
        id: 138, project_id: 10, type: 'threads', is_active: true
    } });
    if (!channel || ([1035, 1040].includes(args.taskId) && channel.name !== 'innokenty_threads')) throw new Error('[THREADS_CHANNEL_NOT_READY]');
    const config = resolveEffectiveChannelConfig('threads', channel.config) as {
        access_token?: string; threads_user_id?: string;
    };
    const connection = await threads.testConnection(config);
    if (!connection.success || connection.details?.username !== 'innokentybo') throw new Error('[THREADS_IDENTITY_NOT_VERIFIED]');
    let after: string | undefined;
    for (let page = 0; page < 5; page += 1) {
        const history = await threads.getOwnPosts(config.access_token || '', connection.details.id, after);
        if (history.items.some(post => createHash('sha256').update(post.text || '').digest('hex') === spec.bodySha256)) {
            throw new Error('[THREADS_PROVIDER_DUPLICATE_FOUND] Reconcile the existing provider post');
        }
        if (!history.after) break;
        if (page === 4) throw new Error('[THREADS_HISTORY_INCOMPLETE]');
        after = history.after;
    }
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    return database.$transaction(async tx => {
        if (args.taskId === 1035 || args.taskId === 1040) {
            const currentOwner = await tx.projectMember.findUnique({ where: { project_id_user_id: {
                project_id: 10, user_id: Number(match[1])
            } } });
            if (currentOwner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        }
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: args.taskId, command: spec.releaseCommand,
            actor_id: args.actorId, idempotency_key: args.idempotencyKey
        } });
        if (prior) {
            if ((prior.before_state as Record<string, unknown>)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            if (!prior.after_state || typeof prior.after_state !== 'object' || Array.isArray(prior.after_state)) throw new Error('[INVALID_RELEASE_HISTORY]');
            return prior.after_state as Record<string, unknown>;
        }
        const newTime = args.taskId === 1040 && args.newScheduleAt ? new Date(args.newScheduleAt) : null;
        if (args.taskId === 1040 && (!newTime || !Number.isFinite(newTime.getTime())
            || newTime.getTime() < Date.now() - 120_000 || newTime.getTime() > Date.now() + 600_000)) {
            throw new Error('[THREADS_NEAR_NOW_SCHEDULE_REQUIRED]');
        }
        const task = await tx.contentItem.findFirst({ where: { id: args.taskId, project_id: 10 }, include: { publication_fact: true } });
        const decision = await tx.artDirectionDecision.findFirst({ where: {
            id: spec.decisionId, project_id: 10, content_item_id: args.taskId,
            source_content_revision: spec.revision, channel: spec.decisionChannel,
            status: 'active', decision: 'NO_VISUAL_NEEDED', placement: 'feed'
        } });
        const hash = hashBody(task?.draft_text || '');
        if (args.taskId === 1040) {
            const report = task?.quality_report;
            const delivery = report && typeof report === 'object' && !Array.isArray(report)
                ? report.publication_task_delivery : null;
            if (delivery && typeof delivery === 'object' && !Array.isArray(delivery)
                && delivery.state === 'provider_result_uncertain') throw new Error('[THREADS_UNCERTAIN_ATTEMPT_EXISTS]');
        }
        if (args.taskId === 1035) {
            const [review, art] = await Promise.all([
                tx.workItem.findFirst({ where: { id: 1550, project_id: 10, content_item_id: 1035,
                    kind: 'content_review', state: 'completed', input_context_version: 1, result_version: 1 } }),
                tx.workItem.findFirst({ where: { id: 1561, project_id: 10, content_item_id: 1035,
                    kind: 'art_direction', state: 'completed', input_context_version: 1, result_version: 1 } })
            ]);
            if (!review || !art || decision?.decision_version !== 1 || task?.visual_placement !== 'feed'
                || task?.publish_at?.toISOString() !== spec.schedule) throw new Error('[THREADS_PENDING_PACKAGE_CHANGED]');
        }
        if (args.taskId === 1040) {
            const [review, art] = await Promise.all([
                tx.workItem.findFirst({ where: { id: 1623, project_id: 10, content_item_id: 1040,
                    kind: 'content_review', state: 'completed', input_context_version: 4, result_version: 4 } }),
                tx.workItem.findFirst({ where: { id: 1624, project_id: 10, content_item_id: 1040,
                    kind: 'art_direction', state: 'completed', input_context_version: 4 } })
            ]);
            if (!review || !art || decision?.decision_version !== 2 || task?.visual_placement !== 'feed'
                || task?.publish_at?.toISOString() !== spec.schedule) throw new Error('[THREADS_PENDING_PACKAGE_CHANGED]');
        }
        if (!task || task.channel_id !== 138 || task.content_revision !== spec.revision || task.accepted_revision !== spec.revision
            || task.text_state !== 'accepted' || task.visual_state !== 'NO_VISUAL_NEEDED'
            || task.selected_asset_id !== null || task.visual_decision_version !== decision?.decision_version
            || task.handoff_state !== 'ready' || !decision || task.publication_fact || task.published_link
            || !['approval_required', 'browser_required'].includes(task.publication_mode || '')
            || !['ready_for_execution', 'browser_required'].includes(task.status)
            || task.schedule_at?.toISOString() !== spec.schedule || hash !== spec.bodySha256
            || !task.draft_text || task.draft_text.length > 500) throw new Error('[THREADS_PENDING_PACKAGE_CHANGED]');
        if (await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: args.taskId } })) throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        if (await tx.workItem.findFirst({ where: { project_id: 10, content_item_id: args.taskId,
            kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })) throw new Error('[BROWSER_CLAIM_EXISTS]');
        const changed = await tx.contentItem.updateMany({ where: {
            id: args.taskId, project_id: 10, channel_id: 138, content_revision: spec.revision, accepted_revision: spec.revision,
            status: task.status, publication_mode: task.publication_mode, selected_asset_id: null,
            schedule_at: task.schedule_at, publish_at: task.publish_at
        }, data: { status: 'ready_for_execution', publication_mode: 'owner_released',
            ...(newTime ? { schedule_at: newTime, publish_at: newTime } : {}) } });
        if (changed.count !== 1) throw new Error('[THREADS_RELEASE_CAS_CONFLICT]');
        const schedule = newTime?.toISOString() || spec.schedule;
        const result = { task_id: args.taskId, channel_id: 138, content_revision: spec.revision, accepted_revision: spec.revision,
            body_sha256: hash, visual_decision_id: spec.decisionId, schedule_at: schedule,
            ...(args.taskId === 1040 ? { publish_at: schedule, previous_schedule_at: spec.schedule,
                manifest_checksum: args.expectedManifestChecksum } : {}),
            publication_mode: 'owner_released', publication_authorized: true, published: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: args.taskId,
            actor_id: args.actorId, command: spec.releaseCommand, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, approval_reference: args.approvalReference,
                status: task.status, publication_mode: task.publication_mode,
                ...(args.taskId === 1040 ? { schedule_at: spec.schedule, publish_at: spec.schedule } : {}) }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
