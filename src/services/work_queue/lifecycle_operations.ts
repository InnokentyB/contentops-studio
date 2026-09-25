import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import artDirectionService from '../art_direction.service';
import { requireProjectAccess } from './auth';
import { checkIdempotency, recordWorkflowEvent } from './infrastructure';

/**
 * Claims a work item with an atomic conditional lease reservation.
 * Supports idempotent replay and expired-lease recovery.
 */
export async function claimWorkItem(params: {
    projectId: number;
    actorId: string;
    workItemId: number;
    leaseSeconds?: number;
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:claim');

        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_claim_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached) {
            const currentLease = await tx.workItem.findFirst({
                where: {
                    id: params.workItemId,
                    project_id: params.projectId,
                    state: 'claimed',
                    lease_actor_id: params.actorId,
                    lease_token: { not: null }
                }
            });
            if (currentLease?.lease_token) {
                return {
                    lease_token: currentLease.lease_token,
                    lease_expires_at: currentLease.lease_expires_at?.toISOString() || null,
                    work_item: {
                        id: currentLease.id,
                        state: currentLease.state,
                        lease_token: currentLease.lease_token
                    }
                };
            }
            return cached as Record<string, unknown>;
        }

        const now = new Date();
        const leaseDuration = Math.min(Math.max(params.leaseSeconds || 1800, 60), 3600);
        const leaseToken = `lease-${randomUUID()}`;
        const leaseExpiresAt = new Date(now.getTime() + leaseDuration * 1000);
        const beforeItem = await tx.workItem.findFirst({
            where: { id: params.workItemId, project_id: params.projectId }
        });

        if (!beforeItem) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }

        const updateResult = await tx.workItem.updateMany({
            where: {
                id: params.workItemId,
                project_id: params.projectId,
                OR: [
                    { state: 'available' },
                    { lease_expires_at: { lt: now } }
                ]
            },
            data: {
                state: 'claimed',
                lease_token: leaseToken,
                lease_expires_at: leaseExpiresAt,
                lease_actor_id: params.actorId
            }
        });

        if (updateResult.count === 0) {
            throw new Error(`[WORK_ITEM_ALREADY_CLAIMED] Work item ${params.workItemId} is currently claimed by ${beforeItem.lease_actor_id || 'another actor'}`);
        }

        const updated = await tx.workItem.findUniqueOrThrow({
            where: { id: params.workItemId }
        });

        const afterState = {
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt.toISOString(),
            work_item: {
                id: updated.id,
                state: updated.state,
                lease_token: leaseToken
            }
        };

        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_claim_work_item',
            beforeState: {
                state: beforeItem.state,
                lease_actor_id: beforeItem.lease_actor_id,
                lease_expires_at: beforeItem.lease_expires_at?.toISOString() || null
            },
            afterState: {
                work_item: { id: updated.id, state: updated.state },
                lease_actor_id: params.actorId,
                lease_expires_at: leaseExpiresAt.toISOString()
            },
            idempotencyKey: params.idempotencyKey
        });

        return afterState;
    });
}

/**
 * Completes a work item execution and unlocks the next stage.
 * Uses atomic conditional UPDATE by (id, project_id, state='claimed', lease_token, lease_actor_id, lease_expires_at >= now).
 */
export async function completeWorkItem(params: {
    projectId: number;
    actorId: string;
    workItemId: number;
    leaseToken: string;
    result: { body?: string; text?: string; format?: string };
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:complete');

        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_complete_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const now = new Date();

        // First get the current result_version to compute increment safely
        const currentItem = await tx.workItem.findFirst({
            where: { id: params.workItemId, project_id: params.projectId }
        });

        if (!currentItem) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }

        const newResultVersion = currentItem.result_version + 1;

        // Atomic conditional UPDATE preventing race conditions
        const updateResult = await tx.workItem.updateMany({
            where: {
                id: params.workItemId,
                project_id: params.projectId,
                state: 'claimed',
                lease_token: params.leaseToken,
                lease_actor_id: params.actorId,
                OR: [
                    { lease_expires_at: null },
                    { lease_expires_at: { gte: now } }
                ]
            },
            data: {
                state: 'completed',
                result_version: newResultVersion,
                result_payload: params.result as unknown as Prisma.InputJsonValue,
                lease_token: null,
                lease_expires_at: null,
                lease_actor_id: null
            }
        });

        if (updateResult.count === 0) {
            // Fetch item to generate precise error diagnostic
            const item = await tx.workItem.findFirst({
                where: { id: params.workItemId, project_id: params.projectId }
            });

            if (!item) {
                throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
            }
            if (item.state !== 'claimed' || !item.lease_token || item.lease_token !== params.leaseToken) {
                throw new Error(`[INVALID_LEASE_TOKEN] Valid active lease token is required to complete work item ${params.workItemId}`);
            }
            if (item.lease_actor_id !== params.actorId) {
                throw new Error(`[UNAUTHORIZED_LEASE_OWNER] Actor ${params.actorId} does not own active lease on work item ${params.workItemId}`);
            }
            if (item.lease_expires_at && now.getTime() > item.lease_expires_at.getTime()) {
                throw new Error(`[LEASE_EXPIRED] Lease token for work item ${params.workItemId} has expired`);
            }
            throw new Error(`[CONCURRENCY_CONFLICT] Work item ${params.workItemId} lease or state was concurrently modified`);
        }

        if (currentItem.content_item_id && currentItem.kind === 'content_write') {
            await artDirectionService.markRevisionStale(tx, currentItem.content_item_id);
            await tx.contentItem.update({
                where: { id: currentItem.content_item_id },
                data: {
                    draft_text: params.result.body || params.result.text || '',
                    status: 'drafted',
                    content_revision: { increment: 1 },
                    text_state: 'draft'
                }
            });

            const existingReview = await tx.workItem.findFirst({
                where: {
                    content_item_id: currentItem.content_item_id,
                    kind: 'content_review'
                }
            });

            if (!existingReview) {
                await tx.workItem.create({
                    data: {
                        project_id: params.projectId,
                        week_package_id: currentItem.week_package_id,
                        content_item_id: currentItem.content_item_id,
                        item_key: currentItem.item_key,
                        kind: 'content_review',
                        state: 'available',
                        assignee_role: 'content_reviewer',
                        result_version: newResultVersion,
                        due_at: currentItem.due_at
                    }
                });
            } else {
                await tx.workItem.update({
                    where: { id: existingReview.id },
                    data: {
                        state: 'available',
                        result_version: newResultVersion
                    }
                });
            }
        }

        const afterState = {
            work_item: {
                id: currentItem.id,
                state: 'completed'
            },
            result_version: newResultVersion
        };

        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_complete_work_item',
            beforeState: { state: currentItem.state },
            afterState,
            idempotencyKey: params.idempotencyKey
        });

        return afterState;
    });
}

/**
 * Blocks a work item manually using atomic conditional UPDATE.
 * Requires an active lease owned by the requesting actor.
 */
export async function blockWorkItem(params: {
    projectId: number;
    actorId: string;
    workItemId: number;
    leaseToken: string;
    reasonCode: string;
    note?: string;
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:block');

        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_block_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const now = new Date();

        const updateResult = await tx.workItem.updateMany({
            where: {
                id: params.workItemId,
                project_id: params.projectId,
                state: 'claimed',
                lease_token: params.leaseToken,
                lease_actor_id: params.actorId,
                OR: [
                    { lease_expires_at: null },
                    { lease_expires_at: { gte: now } }
                ]
            },
            data: {
                state: 'blocked',
                reason_code: params.reasonCode,
                note: params.note || undefined,
                lease_token: null,
                lease_expires_at: null,
                lease_actor_id: null
            }
        });

        if (updateResult.count === 0) {
            const item = await tx.workItem.findFirst({
                where: { id: params.workItemId, project_id: params.projectId }
            });

            if (!item) {
                throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
            }
            if (item.state !== 'claimed' || !item.lease_token || item.lease_token !== params.leaseToken) {
                throw new Error(`[INVALID_LEASE_TOKEN] Valid active lease token is required to block work item ${params.workItemId}`);
            }
            if (item.lease_actor_id !== params.actorId) {
                throw new Error(`[UNAUTHORIZED_LEASE_OWNER] Actor ${params.actorId} does not own active lease on work item ${params.workItemId}`);
            }
            if (item.lease_expires_at && now.getTime() > item.lease_expires_at.getTime()) {
                throw new Error(`[LEASE_EXPIRED] Lease token for work item ${params.workItemId} has expired`);
            }
            throw new Error(`[CONCURRENCY_CONFLICT] Work item ${params.workItemId} lease or state was concurrently modified`);
        }

        const afterState = { work_item: { id: params.workItemId, state: 'blocked' } };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_block_work_item',
            afterState,
            idempotencyKey: params.idempotencyKey
        });

        return afterState;
    });
}

/**
 * Releases a claimed work item lease back to the available queue using atomic conditional UPDATE.
 * Requires an active lease owned by the requesting actor.
 */
export async function releaseWorkItem(params: {
    projectId: number;
    actorId: string;
    workItemId: number;
    leaseToken: string;
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:release');

        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_release_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const now = new Date();

        const updateResult = await tx.workItem.updateMany({
            where: {
                id: params.workItemId,
                project_id: params.projectId,
                state: 'claimed',
                lease_token: params.leaseToken,
                lease_actor_id: params.actorId,
                OR: [
                    { lease_expires_at: null },
                    { lease_expires_at: { gte: now } }
                ]
            },
            data: {
                state: 'available',
                lease_token: null,
                lease_expires_at: null,
                lease_actor_id: null
            }
        });

        if (updateResult.count === 0) {
            const item = await tx.workItem.findFirst({
                where: { id: params.workItemId, project_id: params.projectId }
            });

            if (!item) {
                throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
            }
            if (item.state !== 'claimed' || !item.lease_token || item.lease_token !== params.leaseToken) {
                throw new Error(`[INVALID_LEASE_TOKEN] Valid active lease token is required to release work item ${params.workItemId}`);
            }
            if (item.lease_actor_id !== params.actorId) {
                throw new Error(`[UNAUTHORIZED_LEASE_OWNER] Actor ${params.actorId} does not own active lease on work item ${params.workItemId}`);
            }
            if (item.lease_expires_at && now.getTime() > item.lease_expires_at.getTime()) {
                throw new Error(`[LEASE_EXPIRED] Lease token for work item ${params.workItemId} has expired`);
            }
            throw new Error(`[CONCURRENCY_CONFLICT] Work item ${params.workItemId} lease or state was concurrently modified`);
        }

        const afterState = { work_item: { id: params.workItemId, state: 'available' } };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_release_work_item',
            afterState,
            idempotencyKey: params.idempotencyKey
        });

        return afterState;
    });
}

/**
 * Reschedules a work item due date using atomic conditional UPDATE.
 * Allows the lease owner or non-claimed items to be rescheduled.
 */
export async function rescheduleWorkItem(params: {
    projectId: number;
    actorId: string;
    workItemId: number;
    dueAt: string;
    reason: string;
    idempotencyKey: string;
}): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx) => {
        await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:reschedule');

        const cached = await checkIdempotency(tx, {
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_reschedule_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached) return cached as Record<string, unknown>;

        const currentItem = await tx.workItem.findFirst({
            where: { id: params.workItemId, project_id: params.projectId }
        });

        if (!currentItem) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }

        if (currentItem.state === 'claimed' && currentItem.lease_actor_id && currentItem.lease_actor_id !== params.actorId) {
            throw new Error(`[UNAUTHORIZED_LEASE_OWNER] Actor ${params.actorId} cannot reschedule work item ${params.workItemId} claimed by ${currentItem.lease_actor_id}`);
        }

        const updateResult = await tx.workItem.updateMany({
            where: {
                id: params.workItemId,
                project_id: params.projectId,
                OR: [
                    { state: { not: 'claimed' } },
                    { lease_actor_id: params.actorId }
                ]
            },
            data: {
                due_at: new Date(params.dueAt),
                note: params.reason
            }
        });

        if (updateResult.count === 0) {
            throw new Error(`[CONCURRENCY_CONFLICT] Failed to reschedule work item ${params.workItemId}`);
        }

        const updated = await tx.workItem.findUniqueOrThrow({
            where: { id: params.workItemId }
        });

        const afterState = { work_item: { id: updated.id, due_at: updated.due_at?.toISOString() } };
        await recordWorkflowEvent(tx, {
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_reschedule_work_item',
            beforeState: { due_at: currentItem.due_at?.toISOString() },
            afterState,
            idempotencyKey: params.idempotencyKey
        });

        return afterState;
    });
}
