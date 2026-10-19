import { lockOwnedPublicationTask, assertOwnedPublicationMutable } from '../publication_owned_guard';
import { Prisma } from '@prisma/client';
import { DbClient } from './types';
const APPROVAL_COMMAND = 'ba_decide_approval';
const POSITIVE_DECISION = 'approved';

/**
 * Parameters for checking idempotency of a workflow command.
 */
export interface CheckIdempotencyParams {
    projectId: number;
    actorId: string;
    command: string;
    idempotencyKey?: string;
}

/**
 * Parameters for recording a workflow audit event.
 */
export interface RecordWorkflowEventParams {
    projectId: number;
    workItemId?: number;
    weekPackageId?: number;
    contentItemId?: number;
    actorId: string;
    command: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    idempotencyKey?: string;
}

/**
 * Checks if a workflow event with the idempotency key exists and matches composite scope.
 * Enforces project + actor + command scoping as specified in TDPD-001 Section 10.
 */
export async function checkIdempotency(
    client: DbClient,
    params: CheckIdempotencyParams
): Promise<unknown | null> {
    if (!params.idempotencyKey) return null;

    const existing = await client.workflowEvent.findFirst({
        where: {
            project_id: params.projectId,
            actor_id: params.actorId,
            command: params.command,
            idempotency_key: params.idempotencyKey
        }
    });

    if (existing) {
        if (existing.after_state) {
            return existing.after_state;
        }
    }
    return null;
}

/**
 * Records a workflow audit event.
 */
export async function recordWorkflowEvent(
    client: DbClient,
    params: RecordWorkflowEventParams
): Promise<void> {
    // This postcondition executes inside the approval transaction: failure rolls
    // back its decision, work-item and task writes before anything can commit.
    const approval = params.afterState?.approval;
    if (params.command === APPROVAL_COMMAND && params.workItemId && approval && typeof approval === 'object'
        && 'decision' in approval && approval.decision === POSITIVE_DECISION) {
        const item = await client.workItem.findFirst({ where: { id: params.workItemId, project_id: params.projectId },
            select: { content_item_id: true } });
        if (item?.content_item_id) {
            const scope = { projectId: params.projectId, taskId: item.content_item_id };
            await lockOwnedPublicationTask(client, scope);
            await assertOwnedPublicationMutable(client, scope);
        }
    }
    await client.workflowEvent.create({
        data: {
            project_id: params.projectId,
            work_item_id: params.workItemId || null,
            week_package_id: params.weekPackageId || null,
            content_item_id: params.contentItemId || null,
            actor_id: params.actorId,
            command: params.command,
            before_state: (params.beforeState as Prisma.InputJsonValue) || undefined,
            after_state: (params.afterState as Prisma.InputJsonValue) || undefined,
            idempotency_key: params.idempotencyKey || null
        }
    });
}
