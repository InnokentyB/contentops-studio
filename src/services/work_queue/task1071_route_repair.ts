import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import { repairMaterializedPublicationProjection } from '../publication_metadata_repair';
import { requireProjectOwner } from './auth';
import { checkIdempotency, recordWorkflowEvent } from './infrastructure';

export async function repairTask1071TelegramVideoRoute(params: {
    projectId: number; actorId: string; taskId: number;
    expectedChannelId: number; targetChannelId: number;
    expectedContentRevision: number; expectedAcceptedRevision: number;
    expectedBodySha256: string; decisionId: number; sourceWorkItemId: number;
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    const exactHash = 'f8cf40793a7d3a476bf5a64bcc55df54c70691891c0ac7207470892e790aa337';
    if (params.projectId !== 10 || params.taskId !== 1071 || params.expectedChannelId !== 140
        || params.targetChannelId !== 109 || params.expectedContentRevision !== 1
        || params.expectedAcceptedRevision !== 1 || params.expectedBodySha256 !== exactHash
        || params.decisionId !== 238 || params.sourceWorkItemId !== 1528) {
        throw new Error('[TASK1071_ROUTE_SCOPE_MISMATCH] Exact task/channel/revision/decision is required');
    }
    return prisma.$transaction(async (tx) => {
        await requireProjectOwner(tx, 10, params.actorId);
        const command = 'ba_repair_task1071_telegram_video_route';
        const cached = await checkIdempotency(tx, { projectId: 10, actorId: params.actorId, command, idempotencyKey: params.idempotencyKey });
        if (cached) return cached as Record<string, unknown>;
        const task = await tx.contentItem.findFirst({ where: { id: 1071, project_id: 10 }, include: { publication_fact: true } });
        const channel = await tx.socialChannel.findFirst({ where: { id: 109, project_id: 10 } });
        const decision = await tx.artDirectionDecision.findFirst({ where: { id: 238, project_id: 10, content_item_id: 1071, source_content_revision: 1, status: 'active' } });
        const sourceItem = await tx.workItem.findFirst({ where: { id: 1528, project_id: 10, content_item_id: 1071, kind: 'visual_source_collect' } });
        const bodyHash = createHash('sha256').update(task?.draft_text || '').digest('hex');
        if (!task || task.channel_id !== 140 || task.content_revision !== 1 || task.accepted_revision !== 1
            || task.text_state !== 'accepted' || task.visual_placement !== 'video_cover'
            || task.selected_asset_id !== null || task.publication_fact || task.published_link
            || bodyHash !== exactHash || channel?.type !== 'telegram' || channel.name !== 'analystcraft_tg'
            || decision?.decision !== 'MANUAL_ASSET_REQUIRED' || decision.work_item_id !== 1527
            || !sourceItem || !['available', 'blocked'].includes(sourceItem.state)) {
            throw new Error('[TASK1071_ROUTE_GUARD_FAILED] Production task no longer matches the approved video contract');
        }
        const projection = repairMaterializedPublicationProjection({ assets: task.assets, qualityReport: task.quality_report,
            metrics: task.metrics, channel, placement: 'feed' });
        const changed = await tx.contentItem.updateMany({ where: { id: 1071, project_id: 10, channel_id: 140,
            content_revision: 1, accepted_revision: 1, selected_asset_id: null }, data: {
            channel_id: 109, visual_placement: 'feed', publication_mode: 'approval_required',
            assets: projection.assets as Prisma.InputJsonValue,
            quality_report: projection.qualityReport as Prisma.InputJsonValue,
            metrics: projection.metrics as Prisma.InputJsonValue
        } });
        if (changed.count !== 1) throw new Error('[TASK1071_ROUTE_CAS_CONFLICT]');
        const result = { task_id: 1071, channel_id: 109, channel_type: 'telegram', visual_placement: 'feed',
            content_revision: 1, accepted_revision: 1, decision_id: 238, source_work_item_id: 1528, published: false };
        await recordWorkflowEvent(tx, { projectId: 10, contentItemId: 1071, workItemId: 1528,
            actorId: params.actorId, command, beforeState: { channel_id: 140, visual_placement: 'video_cover' },
            afterState: result, idempotencyKey: params.idempotencyKey });
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
