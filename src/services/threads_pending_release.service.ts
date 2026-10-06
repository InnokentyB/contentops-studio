import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import threadsService from './threads.service';
import { resolveEffectiveChannelConfig } from '../utils/channel.utils';

export const PENDING_THREADS_PACKAGES = {
    1021: { revision: 1, decisionId: 197, decisionChannel: 'threads', chain: false,
        bodySha256: 'f505415d56f83b199ae501ac825694cff849331bf29849b672ea89f732fa9e6b',
        releaseCommand: 'ba_release_approved_threads_task1021', schedule: '2026-10-04T16:30:00.000Z' },
    1026: { revision: 1, decisionId: 231, decisionChannel: 'threads', chain: false,
        bodySha256: '8e7fba9f35b5ea6fef5c27b1a206cf2b0e7ce1afa98e9a949ba1586628f41605',
        releaseCommand: 'ba_release_approved_threads_task1026', schedule: '2026-10-05T16:30:00.000Z' }
} as const;

/** Releases only the owner's two accepted pending Threads packages after identity verification. */
export async function releasePendingThreadsTask(args: {
    projectId: number; taskId: number; actorId: string; approvalReference: string; idempotencyKey: string;
}) {
    const spec = PENDING_THREADS_PACKAGES[args.taskId as keyof typeof PENDING_THREADS_PACKAGES];
    if (args.projectId !== 10 || !spec) throw new Error('[THREADS_PENDING_SCOPE_MISMATCH]');
    const match = /^user:(\d+)$/.exec(args.actorId);
    if (!match || !args.approvalReference?.trim() || !args.idempotencyKey?.trim()) throw new Error('[OWNER_APPROVAL_REQUIRED]');
    const owner = await prisma.projectMember.findUnique({ where: { project_id_user_id: {
        project_id: 10, user_id: Number(match[1])
    } } });
    if (owner?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
    const channel = await prisma.socialChannel.findFirst({ where: {
        id: 138, project_id: 10, type: 'threads', is_active: true
    } });
    if (!channel) throw new Error('[THREADS_CHANNEL_NOT_READY]');
    const config = resolveEffectiveChannelConfig('threads', channel.config) as {
        access_token?: string; threads_user_id?: string;
    };
    const connection = await threadsService.testConnection(config);
    if (!connection.success || connection.details?.username !== 'innokentybo') throw new Error('[THREADS_IDENTITY_NOT_VERIFIED]');
    let after: string | undefined;
    for (let page = 0; page < 5; page += 1) {
        const history = await threadsService.getOwnPosts(config.access_token || '', connection.details.id, after);
        if (history.items.some(post => createHash('sha256').update(post.text || '').digest('hex') === spec.bodySha256)) {
            throw new Error('[THREADS_PROVIDER_DUPLICATE_FOUND] Reconcile the existing provider post');
        }
        if (!history.after) break;
        if (page === 4) throw new Error('[THREADS_HISTORY_INCOMPLETE]');
        after = history.after;
    }
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    return prisma.$transaction(async tx => {
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, content_item_id: args.taskId, command: spec.releaseCommand,
            actor_id: args.actorId, idempotency_key: args.idempotencyKey
        } });
        if (prior) {
            if ((prior.before_state as Record<string, unknown>)?.request_hash !== requestHash) throw new Error('[IDEMPOTENCY_CONFLICT]');
            if (!prior.after_state || typeof prior.after_state !== 'object' || Array.isArray(prior.after_state)) throw new Error('[INVALID_RELEASE_HISTORY]');
            return prior.after_state as Record<string, unknown>;
        }
        const task = await tx.contentItem.findFirst({ where: { id: args.taskId, project_id: 10 }, include: { publication_fact: true } });
        const decision = await tx.artDirectionDecision.findFirst({ where: {
            id: spec.decisionId, project_id: 10, content_item_id: args.taskId,
            source_content_revision: 1, status: 'active', decision: 'NO_VISUAL_NEEDED', placement: 'feed'
        } });
        const hash = createHash('sha256').update(task?.draft_text || '').digest('hex');
        if (!task || task.channel_id !== 138 || task.content_revision !== 1 || task.accepted_revision !== 1
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
            id: args.taskId, project_id: 10, channel_id: 138, content_revision: 1, accepted_revision: 1,
            status: task.status, publication_mode: task.publication_mode, selected_asset_id: null,
            schedule_at: task.schedule_at
        }, data: { status: 'ready_for_execution', publication_mode: 'owner_released' } });
        if (changed.count !== 1) throw new Error('[THREADS_RELEASE_CAS_CONFLICT]');
        const result = { task_id: args.taskId, channel_id: 138, content_revision: 1, accepted_revision: 1,
            body_sha256: hash, visual_decision_id: spec.decisionId, schedule_at: spec.schedule,
            publication_mode: 'owner_released', publication_authorized: true, published: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: args.taskId,
            actor_id: args.actorId, command: spec.releaseCommand, idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, approval_reference: args.approvalReference,
                status: task.status, publication_mode: task.publication_mode }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
