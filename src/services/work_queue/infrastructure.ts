import { Prisma } from '@prisma/client';
import { DbClient } from './types';

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
