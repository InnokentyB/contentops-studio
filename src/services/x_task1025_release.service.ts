import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { loadAgentWorkspaceManifest } from './agent_workspace_manifest.service';
import workQueueService from './work_queue.service';

const BODY_SHA = '2e0af78370143fbc4604726a70c3ebc70f63167f608da5413b5029181afe785c';
const MANIFEST_CHECKSUM = 'sha256:5500db954642b50ac4077ce9ef6ae8bd78f9382cc87d7911b0baacdaf95860d3';
const SCHEDULE = '2026-10-05T15:00:00.000Z';

export type Task1025ReleaseArgs = {
    projectId: 10;
    taskId: 1025;
    actorId: string;
    expectedChannelId: 164;
    expectedContentRevision: 1;
    expectedAcceptedRevision: 1;
    expectedBodySha256: typeof BODY_SHA;
    expectedDecisionId: 230;
    expectedReviewWorkItemId: 1475;
    expectedArtWorkItemId: 1477;
    expectedScheduleAt: typeof SCHEDULE;
    expectedManifestChecksum: typeof MANIFEST_CHECKSUM;
    approvalReference: string;
    idempotencyKey: string;
};

type Database = typeof prisma;

/**
 * Exact owner-only release for Personal X task 1025.
 * It creates one browser queue item and never contacts X or records a publication fact.
 */
export async function releaseXTask1025(
    args: Task1025ReleaseArgs,
    database: Database = prisma,
    manifestLoader = loadAgentWorkspaceManifest
) {
    if (args.projectId !== 10 || args.taskId !== 1025 || args.expectedChannelId !== 164
        || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
        || args.expectedBodySha256 !== BODY_SHA || args.expectedDecisionId !== 230
        || args.expectedReviewWorkItemId !== 1475 || args.expectedArtWorkItemId !== 1477
        || args.expectedScheduleAt !== SCHEDULE || args.expectedManifestChecksum !== MANIFEST_CHECKSUM) {
        throw new Error('[TASK1025_RELEASE_SCOPE_MISMATCH] Exact release package is required');
    }
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    const actorMatch = /^user:(\d+)$/.exec(args.actorId);
    if (!actorMatch) throw new Error('[OWNER_REQUIRED]');
    const manifest = await manifestLoader(10, Number(actorMatch[1]));
    if (manifest.checksum !== MANIFEST_CHECKSUM) throw new Error('[STALE_MANIFEST]');
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');

    return database.$transaction(async (tx) => {
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: 10, user_id: Number(actorMatch[1])
        } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = 'ba_release_x_task1025_browser';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 10, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if ((prior.before_state as Record<string, unknown> | null)?.request_hash !== requestHash) {
                throw new Error('[IDEMPOTENCY_CONFLICT]');
            }
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }

        const task = await tx.contentItem.findFirst({ where: { id: 1025, project_id: 10 },
            include: { channel: true, publication_fact: true } });
        const [review, art, decision] = await Promise.all([
            tx.workItem.findFirst({ where: { id: 1475, project_id: 10, content_item_id: 1025 } }),
            tx.workItem.findFirst({ where: { id: 1477, project_id: 10, content_item_id: 1025 } }),
            tx.artDirectionDecision.findFirst({ where: { id: 230, project_id: 10,
                content_item_id: 1025, source_content_revision: 1, decision: 'NO_VISUAL_NEEDED', status: 'active' } })
        ]);
        const bodyHash = createHash('sha256').update(task?.draft_text || '').digest('hex');
        if (!task || task.channel_id !== 164 || task.channel?.type !== 'x'
            || task.channel.name !== 'innokenty_x' || task.status !== 'ready_for_execution'
            || task.handoff_state !== 'ready' || task.publication_mode !== 'approval_required'
            || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
            || task.visual_state !== 'NO_VISUAL_NEEDED' || task.visual_placement !== 'feed'
            || task.selected_asset_id !== null || task.schedule_at?.toISOString() !== SCHEDULE
            || task.publish_at?.toISOString() !== SCHEDULE || bodyHash !== BODY_SHA
            || task.publication_fact || task.published_link || !decision
            || review?.kind !== 'content_review' || review.state !== 'completed'
            || review.input_context_version !== 1 || art?.kind !== 'art_direction'
            || art.state !== 'completed' || art.input_context_version !== 1) {
            throw new Error('[TASK1025_RELEASE_GUARD_FAILED] Production package changed');
        }
        if (await tx.deliveryAttempt.findFirst({ where: { project_id: 10, content_item_id: 1025 } })) {
            throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        }
        if (await tx.workItem.findFirst({ where: { project_id: 10, content_item_id: 1025,
            kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })) {
            throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');
        }

        const changed = await tx.contentItem.updateMany({ where: { id: 1025, project_id: 10,
            channel_id: 164, status: 'ready_for_execution', handoff_state: 'ready',
            publication_mode: 'approval_required', content_revision: 1, accepted_revision: 1,
            selected_asset_id: null, schedule_at: new Date(SCHEDULE), publish_at: new Date(SCHEDULE)
        }, data: {
            status: 'browser_required', publication_mode: 'browser_required',
            quality_report: { ...((task.quality_report as Record<string, unknown> | null) || {}),
                publication_route: 'browser_required', owner_release: {
                    publication_authorized: true, actor_id: args.actorId,
                    approval_reference: args.approvalReference, content_revision: 1,
                    body_sha256: BODY_SHA, selected_asset_id: null, released_at: new Date().toISOString()
                } }
        } });
        if (changed.count !== 1) throw new Error('[TASK1025_RELEASE_CAS_CONFLICT]');
        const browserItem = await tx.workItem.create({ data: {
            project_id: 10, week_package_id: task.week_package_id, content_item_id: 1025,
            item_key: task.item_key || 'publication-1025', kind: 'browser_publish', state: 'available',
            assignee_role: 'browser_publisher', due_at: task.schedule_at,
            reason_code: 'OWNER_RELEASED_BROWSER_PUBLICATION', input_context_version: 1,
            dedupe_key: 'browser_publish:1025:r1',
            note: 'Owner released exact accepted Personal X task 1025 for one browser publication.',
            result_payload: { publication_authorized: true, content_revision: 1,
                body_sha256: BODY_SHA, selected_asset_id: null, channel_id: 164,
                confirmed_review_work_item_id: 1475, confirmed_art_work_item_id: 1477,
                visual_decision_id: 230 } as Prisma.InputJsonValue
        } });
        const result = { project_id: 10, task_id: 1025, channel_id: 164,
            content_revision: 1, accepted_revision: 1, body_sha256: BODY_SHA,
            selected_asset_id: null, visual_decision_id: 230, schedule_at: SCHEDULE,
            publication_mode: 'browser_required', browser_work_item_id: browserItem.id,
            published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 10, content_item_id: 1025,
            work_item_id: browserItem.id, actor_id: args.actorId, command,
            idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, manifest_checksum: manifest.checksum,
                status: task.status, publication_mode: task.publication_mode }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Publisher-scoped claim for an owner-released Personal X browser publication. */
export async function claimXBrowserPublication(args: {
    projectId: number;
    actorId: string;
    workItemId: number;
    leaseSeconds?: number;
    idempotencyKey: string;
}) {
    const item = await prisma.workItem.findFirst({ where: {
        id: args.workItemId, project_id: args.projectId, kind: 'browser_publish',
        assignee_role: 'browser_publisher', content_item: {
            id: 1025, channel: { type: 'x' }, status: 'browser_required',
            publication_mode: 'browser_required', publication_fact: null, published_link: null
        }
    }, select: { id: true } });
    if (!item) throw new Error('[X_BROWSER_WORK_ITEM_REQUIRED]');
    return workQueueService.claimWorkItem(args);
}

export default { releaseXTask1025, claimXBrowserPublication };
