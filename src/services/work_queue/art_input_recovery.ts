import {Prisma} from '@prisma/client';
import prisma from '../../db';
import {assertCanonicalPublicationPlacement} from '../publication_placement_contract';
import {requireProjectOwner} from './auth';
import {checkIdempotency,recordWorkflowEvent} from './infrastructure';
export async function recoverArtDirectionInput(params: {
    projectId: number;
    actorId: string;
    taskId: number;
    expectedChannelId: number;
    expectedPlacement: string;
    expectedRevision: number;
    oldWorkItemId: number;
    oldDecisionId: number;
    idempotencyKey: string;
}, database: typeof prisma = prisma): Promise<Record<string, unknown>> {
    return database.$transaction(async (tx) => {
        await requireProjectOwner(tx, params.projectId, params.actorId);
        const command = 'ba_recover_art_direction_input';
        const cached = await checkIdempotency(tx, {
            projectId: params.projectId, actorId: params.actorId, command,
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const task = await tx.contentItem.findFirst({
            where: { id: params.taskId, project_id: params.projectId },
            include: { channel: true, publication_fact: true }
        });
        if (!task || !task.channel || task.channel_id !== params.expectedChannelId
            || task.visual_placement !== params.expectedPlacement
            || task.content_revision !== params.expectedRevision
            || task.accepted_revision !== params.expectedRevision
            || task.text_state !== 'accepted'
            || task.status !== 'approved' || task.visual_state !== 'BRIEFED'
            || task.handoff_state !== 'blocked' || task.selected_asset_id !== null
            || task.published_link || task.publication_fact) {
            throw new Error('[ART_RECOVERY_TASK_CONFLICT] Task no longer matches the accepted unpublished visual hold');
        }
        assertCanonicalPublicationPlacement(task.channel, params.expectedPlacement);
        const oldWorkItem = await tx.workItem.findFirst({
            where: {
                id: params.oldWorkItemId, project_id: params.projectId,
                content_item_id: task.id, kind: 'art_direction', state: 'completed',
                input_context_version: params.expectedRevision
            }
        });
        const oldDecision = await tx.artDirectionDecision.findFirst({
            where: {
                id: params.oldDecisionId, project_id: params.projectId,
                content_item_id: task.id, work_item_id: params.oldWorkItemId,
                decision_version: task.visual_decision_version, status: 'active'
            }
        });
        if (!oldWorkItem || !oldDecision || oldWorkItem.result_version !== oldDecision.decision_version) {
            throw new Error('[ART_RECOVERY_EVIDENCE_CONFLICT] Immutable work item or decision changed');
        }
        const newerInput = await tx.workItem.findFirst({
            where: {
                project_id: params.projectId, content_item_id: task.id, kind: 'art_direction',
                id: { not: oldWorkItem.id },
                state: { in: ['available', 'claimed', 'waiting_approval', 'completed'] },
                input_context_version: params.expectedRevision
            }
        });
        const newerAsset = await tx.imageAsset.findFirst({
            where: { project_id: params.projectId, content_item_id: task.id,
                content_revision: params.expectedRevision,
                decision: { is: { decision_version: { gt: oldDecision.decision_version } } } }
        });
        if (newerInput || newerAsset) {
            throw new Error('[ART_RECOVERY_ALREADY_SUPERSEDED] Newer valid input or asset exists');
        }
        const activeGenerator = await tx.workItem.findFirst({
            where: {
                project_id: params.projectId, content_item_id: task.id,
                kind: 'visual_generate', input_context_version: params.expectedRevision,
                state: 'claimed',
                result_payload: { path: ['decision_id'], equals: oldDecision.id }
            }
        });
        if (activeGenerator) {
            throw new Error('[ART_RECOVERY_GENERATOR_ACTIVE] Existing generation lease must finish or be safely released first');
        }

        const update = await tx.contentItem.updateMany({
            where: {
                id: task.id, project_id: params.projectId, channel_id: params.expectedChannelId,
                visual_placement: params.expectedPlacement, content_revision: params.expectedRevision,
                accepted_revision: params.expectedRevision, status: 'approved',
                visual_state: 'BRIEFED', handoff_state: 'blocked', selected_asset_id: null,
                visual_decision_version: oldDecision.decision_version
            },
            data: { visual_state: 'PENDING_ASSESSMENT' }
        });
        if (update.count !== 1) throw new Error('[ART_RECOVERY_RACE] Task changed concurrently');
        const staleGenerators = await tx.workItem.updateMany({
            where: {
                project_id: params.projectId, content_item_id: task.id,
                kind: 'visual_generate', input_context_version: params.expectedRevision,
                state: { in: ['available', 'waiting_approval'] },
                result_payload: { path: ['decision_id'], equals: oldDecision.id }
            },
            data: {
                state: 'blocked', reason_code: 'superseded_art_direction_input',
                note: `Held pending a new art-direction decision; prior decision ${oldDecision.id} retained as audit evidence`
            }
        });
        const dedupeKey = `art-direction:${task.id}:${params.expectedRevision}:${params.expectedPlacement}:contract-recovery:${oldWorkItem.id}`;
        const fresh = await tx.workItem.create({
            data: {
                project_id: params.projectId, week_package_id: task.week_package_id,
                content_item_id: task.id, item_key: task.item_key || `content:${task.id}`,
                kind: 'art_direction', state: 'available', assignee_role: 'art_director',
                input_context_version: params.expectedRevision, result_version: 0,
                dedupe_key: dedupeKey,
                note: `Reassess canonical ${task.channel.name}/${params.expectedPlacement} contract; prior work item ${oldWorkItem.id} and decision ${oldDecision.id} retained unchanged`,
                result_payload: {
                    recovery_kind: 'canonical_visual_contract',
                    superseded_work_item_id: oldWorkItem.id,
                    superseded_decision_id: oldDecision.id,
                    channel_id: task.channel.id, channel_type: task.channel.type,
                    placement: params.expectedPlacement
                }
            }
        });
        const result = {
            task_id: task.id, channel_id: task.channel.id, channel_type: task.channel.type,
            placement: params.expectedPlacement, accepted_revision: params.expectedRevision,
            old_work_item_id: oldWorkItem.id, old_decision_id: oldDecision.id,
            held_visual_generate_count: staleGenerators.count,
            art_direction_work_item_id: fresh.id, art_direction_state: fresh.state,
            input_context_version: fresh.input_context_version, result_version: fresh.result_version,
            visual_state: 'PENDING_ASSESSMENT', handoff_state: 'blocked'
        };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId, workItemId: fresh.id,
            weekPackageId: task.week_package_id || undefined, contentItemId: task.id,
            actorId: params.actorId, command, idempotencyKey: params.idempotencyKey,
            beforeState: { visual_state: task.visual_state, old_work_item_id: oldWorkItem.id,
                old_decision_id: oldDecision.id }, afterState: result
        });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Requires visual production for an exact accepted, unpublished task and creates
 * the first revision-bound art-direction input. It does not bind a channel,
 * alter copy/schedule, attach an asset, or grant publication authority.
 */
