import { Prisma } from '@prisma/client';
import prisma from '../db';
import { PublicationPreviewError, type PublicationPreviewInput } from './publication_preview_contract';

const taskSelect = {
    id: true, project_id: true, channel_id: true, content_revision: true, accepted_revision: true,
    draft_text: true, text_state: true, visual_state: true, visual_mode: true, visual_placement: true,
    visual_decision_version: true, selected_asset_id: true, status: true, handoff_state: true,
    publication_mode: true, schedule_at: true, publish_at: true, published_link: true,
    channel: {select: {id: true, project_id: true, type: true, is_active: true}},
    selected_asset: {select: {id: true, project_id: true, content_item_id: true, content_revision: true,
        decision_id: true, placement: true, status: true}},
    art_direction_decisions: {where: {status: 'active'}, take: 2, orderBy: {decision_version: 'desc'},
        select: {id: true, project_id: true, content_item_id: true, source_content_revision: true,
            decision_version: true, decision: true, status: true, channel: true, placement: true}},
    publication_fact: {select: {id: true}}
} satisfies Prisma.ContentItemSelect;

/** Consistent read-only snapshot; never load channel config, credential material or raw workflow payloads. */
export async function readPublicationPreview(args: PublicationPreviewInput, userId: number) {
    return prisma.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const member = await tx.projectMember.findUnique({
            where: {project_id_user_id: {project_id: args.projectId, user_id: userId}}, select: {id: true}
        });
        if (!member) throw new PublicationPreviewError('PREVIEW_PROJECT_ACCESS_DENIED');
        const task = await tx.contentItem.findFirst({where: {id: args.taskId, project_id: args.projectId}, select: taskSelect});
        if (!task) throw new PublicationPreviewError('PREVIEW_TASK_NOT_FOUND');
        // Project only presence/truthiness; never materialize the potentially secret report.
        const holds = await tx.$queryRaw<{publication_hold: boolean; visual_reassessment_pending: boolean}[]>`
            SELECT (quality_report IS NOT NULL AND jsonb_typeof(quality_report) <> 'object')
                OR COALESCE(quality_report->'publication_hold' NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb), false) AS publication_hold,
                EXISTS (SELECT 1 FROM (
                    SELECT after_state FROM planner.workflow_events
                    WHERE project_id = ${args.projectId} AND content_item_id = ${args.taskId}
                        AND command = 'ba_request_publication_visual_reassessment' ORDER BY id DESC LIMIT 1
                ) request WHERE NOT (
                    request.after_state #> '{binding,revision}' IS DISTINCT FROM to_jsonb(t.content_revision)
                    AND EXISTS (SELECT 1 FROM planner.workflow_events completed
                        WHERE completed.project_id = t.project_id AND completed.content_item_id = t.id
                            AND completed.command = 'ba_complete_publication_visual_reassessment'
                            AND request.after_state #> '{binding,version}' = '1'::jsonb
                            AND jsonb_typeof(request.after_state #> '{binding,generation}') = 'string'
                            AND jsonb_typeof(request.after_state #> '{binding,revision}') = 'number'
                            AND completed.after_state->'generation' = request.after_state #> '{binding,generation}')
                ) AND (t.visual_mode IS DISTINCT FROM 'required' OR t.visual_state IS DISTINCT FROM 'APPROVED'
                    OR t.selected_asset_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM planner.workflow_events completed
                        WHERE completed.project_id = t.project_id AND completed.content_item_id = t.id
                            AND completed.command = 'ba_complete_publication_visual_reassessment'
                            AND request.after_state #> '{binding,version}' = '1'::jsonb
                            AND jsonb_typeof(request.after_state #> '{binding,generation}') = 'string'
                            AND jsonb_typeof(request.after_state #> '{binding,revision}') = 'number'
                            AND completed.after_state->'generation' = request.after_state #> '{binding,generation}'
                            AND completed.after_state->'asset_id' = to_jsonb(t.selected_asset_id)
                            AND completed.after_state->'decision_id' = to_jsonb(${task.selected_asset?.decision_id??null}::integer)
                    ))) AS visual_reassessment_pending
            FROM planner.content_items t WHERE id = ${args.taskId} AND project_id = ${args.projectId}`;
        if (holds.length !== 1) throw new PublicationPreviewError('PREVIEW_DEPENDENCY_UNAVAILABLE');
        const [attemptCount, latestAttempt, activeWork] = await Promise.all([
            tx.deliveryAttempt.count({where: {project_id: args.projectId, content_item_id: args.taskId}}),
            tx.deliveryAttempt.findFirst({where: {project_id: args.projectId, content_item_id: args.taskId},
                orderBy: {created_at: 'desc'}, select: {id: true, status: true, requires_manual_confirmation: true}}),
            tx.workItem.count({where: {project_id: args.projectId, content_item_id: args.taskId, state: 'claimed'}})
        ]);
        return {task, attemptCount, latestAttempt, activeWork, publicationHold: holds[0].publication_hold,
            visualReassessmentPending: holds[0].visual_reassessment_pending};
    }, {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 1000, timeout: 5000});
}
export type PublicationPreviewRecords = Awaited<ReturnType<typeof readPublicationPreview>>;
