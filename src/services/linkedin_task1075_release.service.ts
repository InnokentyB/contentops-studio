import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';

const BODY_SHA = '24ce0bc8c6863662a8af115bef9a200dc3d75ca5b051b9d3ba6a04fc7109fb4f';
const SCHEDULE = '2026-10-05T09:00:00.000Z';

export type Task1075ReleaseArgs = {
    projectId: 7; taskId: 1075; actorId: string; expectedChannelId: 5;
    expectedContentRevision: 1; expectedAcceptedRevision: 1; expectedBodySha256: typeof BODY_SHA;
    expectedDecisionId: 234; expectedScheduleAt: typeof SCHEDULE;
    staleUpstreamWorkItemId: 1408; expectedEditorWorkItemId: 1483; expectedArtWorkItemId: 1484;
    approvalReference: string; idempotencyKey: string;
};

export async function releaseLinkedInTask1075(args: Task1075ReleaseArgs, database: typeof prisma = prisma) {
    if (args.projectId !== 7 || args.taskId !== 1075 || args.expectedChannelId !== 5
        || args.expectedContentRevision !== 1 || args.expectedAcceptedRevision !== 1
        || args.expectedBodySha256 !== BODY_SHA || args.expectedDecisionId !== 234
        || args.expectedScheduleAt !== SCHEDULE || args.staleUpstreamWorkItemId !== 1408
        || args.expectedEditorWorkItemId !== 1483 || args.expectedArtWorkItemId !== 1484) {
        throw new Error('[TASK1075_RELEASE_SCOPE_MISMATCH] Exact release package is required');
    }
    if (!args.approvalReference.trim()) throw new Error('[OWNER_APPROVAL_REFERENCE_REQUIRED]');
    const match = /^user:(\d+)$/.exec(args.actorId);
    if (!match) throw new Error('[OWNER_REQUIRED]');
    const requestHash = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    return database.$transaction(async (tx) => {
        const membership = await tx.projectMember.findUnique({ where: { project_id_user_id: {
            project_id: 7, user_id: Number(match[1])
        } } });
        if (membership?.role !== 'owner') throw new Error('[OWNER_REQUIRED]');
        const command = 'ba_release_linkedin_task1075_browser';
        const prior = await tx.workflowEvent.findFirst({ where: {
            project_id: 7, actor_id: args.actorId, command, idempotency_key: args.idempotencyKey
        } });
        if (prior?.after_state) {
            if ((prior.before_state as Record<string, unknown> | null)?.request_hash !== requestHash) {
                throw new Error('[IDEMPOTENCY_CONFLICT]');
            }
            return { ...(prior.after_state as Record<string, unknown>), replayed: true };
        }
        const task = await tx.contentItem.findFirst({ where: { id: 1075, project_id: 7 },
            include: { channel: true, publication_fact: true } });
        const workItems = await tx.workItem.findMany({ where: { project_id: 7, content_item_id: 1075,
            id: { in: [1408, 1483, 1484] } } });
        const stale = workItems.find(item => item.id === 1408);
        const editor = workItems.find(item => item.id === 1483);
        const art = workItems.find(item => item.id === 1484);
        const decision = await tx.artDirectionDecision.findFirst({ where: { id: 234, project_id: 7,
            content_item_id: 1075, source_content_revision: 1, decision: 'NO_VISUAL_NEEDED', status: 'active' } });
        const bodyHash = createHash('sha256').update(task?.draft_text || '').digest('hex');
        if (!task || task.channel_id !== 5 || task.channel?.type !== 'linkedin'
            || task.channel.name !== 'innokentiy_linkedin' || task.status !== 'ready_for_execution'
            || task.handoff_state !== 'ready' || task.publication_mode !== 'approval_required'
            || task.content_revision !== 1 || task.accepted_revision !== 1 || task.text_state !== 'accepted'
            || task.visual_state !== 'NO_VISUAL_NEEDED' || task.visual_placement !== 'feed'
            || task.selected_asset_id !== null || task.schedule_at?.toISOString() !== SCHEDULE
            || bodyHash !== BODY_SHA || task.publication_fact || task.published_link || !decision
            || stale?.kind !== 'content_write' || stale.state !== 'blocked' || stale.reason_code !== 'missing_source_package'
            || stale.input_context_version !== 1 || editor?.kind !== 'content_review' || editor.state !== 'completed'
            || editor.input_context_version !== 1 || art?.kind !== 'art_direction' || art.state !== 'completed'
            || art.input_context_version !== 1) {
            throw new Error('[TASK1075_RELEASE_GUARD_FAILED] Production package changed');
        }
        if (await tx.deliveryAttempt.findFirst({ where: { project_id: 7, content_item_id: 1075 } })) {
            throw new Error('[DELIVERY_ATTEMPT_EXISTS]');
        }
        if (await tx.workItem.findFirst({ where: { project_id: 7, content_item_id: 1075,
            kind: 'browser_publish', state: { notIn: ['completed', 'cancelled'] } } })) {
            throw new Error('[BROWSER_PUBLICATION_ALREADY_QUEUED]');
        }
        const changed = await tx.contentItem.updateMany({ where: { id: 1075, project_id: 7, channel_id: 5,
            status: 'ready_for_execution', publication_mode: 'approval_required', content_revision: 1,
            accepted_revision: 1, selected_asset_id: null, schedule_at: new Date(SCHEDULE) }, data: {
            status: 'browser_required', publication_mode: 'browser_required',
            quality_report: { ...((task.quality_report as Record<string, unknown> | null) || {}),
                publication_route: 'browser_required', owner_release: { publication_authorized: true,
                    actor_id: args.actorId, approval_reference: args.approvalReference,
                    content_revision: 1, body_sha256: BODY_SHA, selected_asset_id: null,
                    released_at: new Date().toISOString() } }
        } });
        if (changed.count !== 1) throw new Error('[TASK1075_RELEASE_CAS_CONFLICT]');
        await tx.workItem.updateMany({ where: { id: 1408, project_id: 7, content_item_id: 1075,
            state: 'blocked', reason_code: 'missing_source_package' }, data: {
            reason_code: 'superseded_stale_upstream_projection',
            note: 'Superseded after completed content review #1483 and art direction #1484; not a release blocker.'
        } });
        const browserItem = await tx.workItem.create({ data: { project_id: 7,
            week_package_id: task.week_package_id, content_item_id: 1075,
            item_key: task.item_key || 'publication-1075', kind: 'browser_publish', state: 'available',
            assignee_role: 'browser_publisher', due_at: task.schedule_at,
            reason_code: 'OWNER_RELEASED_BROWSER_PUBLICATION', input_context_version: 1,
            dedupe_key: 'browser_publish:1075:r1',
            note: 'Owner released exact accepted LinkedIn task 1075 for one browser publication.',
            result_payload: { publication_authorized: true, content_revision: 1,
                body_sha256: BODY_SHA, selected_asset_id: null, channel_id: 5,
                stale_upstream_work_item_id: 1408, confirmed_editor_work_item_id: 1483,
                confirmed_art_work_item_id: 1484 } as Prisma.InputJsonValue
        } });
        const result = { project_id: 7, task_id: 1075, channel_id: 5, content_revision: 1,
            accepted_revision: 1, body_sha256: BODY_SHA, selected_asset_id: null,
            visual_decision_id: 234, schedule_at: SCHEDULE, publication_mode: 'browser_required',
            browser_work_item_id: browserItem.id, stale_work_item_id: 1408,
            stale_work_item_reason: 'superseded_stale_upstream_projection', published: false, replayed: false };
        await tx.workflowEvent.create({ data: { project_id: 7, content_item_id: 1075,
            work_item_id: browserItem.id, actor_id: args.actorId, command,
            idempotency_key: args.idempotencyKey,
            before_state: { request_hash: requestHash, status: task.status,
                publication_mode: task.publication_mode, stale_work_item_id: 1408,
                stale_reason_code: 'missing_source_package' }, after_state: result } });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export default { releaseLinkedInTask1075 };
