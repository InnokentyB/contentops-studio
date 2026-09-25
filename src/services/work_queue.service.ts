import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import artDirectionService from './art_direction.service';
import { assertContentReviewInput } from './content_review_gate';
import { WorkQueueScope, DbClient } from './work_queue/types';
import { requireProjectAccess, assertProjectAccess as _assertProjectAccess, requireProjectOwner, bindServiceIdentity, unbindServiceIdentity, listServiceBindings } from './work_queue/auth';
import { checkIdempotency, recordWorkflowEvent } from './work_queue/infrastructure';
import { recoverArtDirectionInput, requirePublicationVisual, repairPublicationPlacement, repairPublicationProjection, recoverMissingContentReview, recoverContentReview } from './work_queue/recovery_operations';
import { claimWorkItem, completeWorkItem, blockWorkItem, releaseWorkItem, rescheduleWorkItem } from './work_queue/lifecycle_operations';
import { listWorkItems, getWorkItem, getWorkItemContext, listScheduleExceptions, getWeekExecutionSummary } from './work_queue/query_operations';

export type { WorkQueueScope } from './work_queue/types';

/**
 * Facade class preserving the original WorkQueueService API surface.
 * Delegates to focused sub-modules for recovery, auth, lifecycle, and query operations.
 */
export class WorkQueueService {
    // ── Recovery Operations ─────────────────────────────────────────────
    /** @see recoverArtDirectionInput in recovery_operations.ts */
    recoverArtDirectionInput = recoverArtDirectionInput;
    /** @see requirePublicationVisual in recovery_operations.ts */
    requirePublicationVisual = requirePublicationVisual;
    /** @see repairPublicationPlacement in recovery_operations.ts */
    repairPublicationPlacement = repairPublicationPlacement;
    /** @see repairPublicationProjection in recovery_operations.ts */
    repairPublicationProjection = repairPublicationProjection;
    /** @see recoverMissingContentReview in recovery_operations.ts */
    recoverMissingContentReview = recoverMissingContentReview;
    /** @see recoverContentReview in recovery_operations.ts */
    recoverContentReview = recoverContentReview;

    // ── Auth & Service Identity ─────────────────────────────────────────
    /** @see bindServiceIdentity in auth.ts */
    bindServiceIdentity = bindServiceIdentity;
    /** @see unbindServiceIdentity in auth.ts */
    unbindServiceIdentity = unbindServiceIdentity;
    /** @see listServiceBindings in auth.ts */
    listServiceBindings = listServiceBindings;

    /**
     * Shared authorization boundary for adjacent MCP workflow services.
     * Keeps project membership and service-identity binding checks in one place.
     */
    async assertProjectAccess(
        client: DbClient,
        projectId: number,
        actorId: string,
        requiredScope?: WorkQueueScope
    ): Promise<void> {
        await _assertProjectAccess(client, projectId, actorId, requiredScope);
    }

    // ── Lifecycle Operations ────────────────────────────────────────────
    /** @see claimWorkItem in lifecycle_operations.ts */
    claimWorkItem = claimWorkItem;
    /** @see completeWorkItem in lifecycle_operations.ts */
    completeWorkItem = completeWorkItem;
    /** @see blockWorkItem in lifecycle_operations.ts */
    blockWorkItem = blockWorkItem;
    /** @see releaseWorkItem in lifecycle_operations.ts */
    releaseWorkItem = releaseWorkItem;
    /** @see rescheduleWorkItem in lifecycle_operations.ts */
    rescheduleWorkItem = rescheduleWorkItem;

    // ── Query Operations ────────────────────────────────────────────────
    /** @see listWorkItems in query_operations.ts */
    listWorkItems = listWorkItems;
    /** @see getWorkItem in query_operations.ts */
    getWorkItem = getWorkItem;
    /** @see getWorkItemContext in query_operations.ts */
    getWorkItemContext = getWorkItemContext;
    /** @see listScheduleExceptions in query_operations.ts */
    listScheduleExceptions = listScheduleExceptions;
    /** @see getWeekExecutionSummary in query_operations.ts */
    getWeekExecutionSummary = getWeekExecutionSummary;

    // ── Inline Operations (kept in facade) ──────────────────────────────

    /**
     * Decides on a week plan (approves or rejects).
     * On approval, unlocks content_write work items for materials in the package.
     */
    async decideWeekPlan(params: {
        projectId: number;
        actorId: string;
        weekPackageId: number;
        planVersion: string;
        decision: 'approved' | 'rejected';
        comment?: string;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:decide');

            const cached = await checkIdempotency(tx, {
                projectId: params.projectId,
                actorId: params.actorId,
                command: 'ba_decide_week_plan',
                idempotencyKey: params.idempotencyKey
            });
            if (cached) return cached as Record<string, unknown>;

            const weekPackage = await tx.weekPackage.findFirst({
                where: {
                    id: params.weekPackageId,
                    project_id: params.projectId
                },
                include: {
                    content_items: true
                }
            });

            if (!weekPackage) {
                throw new Error(`WeekPackage ${params.weekPackageId} not found in project ${params.projectId}`);
            }

            await tx.$queryRaw(Prisma.sql`SELECT id FROM planner.week_packages WHERE id = ${weekPackage.id} FOR UPDATE`);
            const replayAfterLock = await checkIdempotency(tx, {
                projectId: params.projectId,
                actorId: params.actorId,
                command: 'ba_decide_week_plan',
                idempotencyKey: params.idempotencyKey
            });
            if (replayAfterLock) return replayAfterLock as Record<string, unknown>;

            const beforeState = { approval_status: weekPackage.approval_status };

            if (!weekPackage.plan_version || weekPackage.plan_version !== params.planVersion) {
                throw new Error('[STALE_THEME_REVISION] Weekly plan was generated from an outdated theme revision');
            }

            if (params.decision === 'approved') {
                await tx.weekPackage.update({
                    where: { id: params.weekPackageId },
                    data: {
                        approval_status: 'approved',
                        plan_version: params.planVersion
                    }
                });

                await tx.workItem.updateMany({
                    where: {
                        week_package_id: params.weekPackageId,
                        kind: 'plan_review'
                    },
                    data: { state: 'completed' }
                });

                for (const item of weekPackage.content_items) {
                    if (item.type === 'week_theme') continue;
                    const existingWrite = await tx.workItem.findFirst({
                        where: {
                            content_item_id: item.id,
                            kind: 'content_write'
                        }
                    });

                    if (!existingWrite) {
                        const sourceRefs: unknown[] = Array.isArray(item.source_refs) ? item.source_refs : [];
                        const missingRefs: string[] = [];

                        for (const ref of sourceRefs) {
                            const pathVal = typeof ref === 'string' ? ref : ((ref as { path?: string; url_ref?: string })?.path || (ref as { path?: string; url_ref?: string })?.url_ref || '');
                            if (typeof pathVal === 'string' && pathVal.startsWith('/host-only')) {
                                missingRefs.push(pathVal);
                            }
                        }

                        const isBlocked = missingRefs.length > 0;

                        await tx.workItem.create({
                            data: {
                                project_id: params.projectId,
                                week_package_id: params.weekPackageId,
                                content_item_id: item.id,
                                item_key: item.item_key || item.title || `item-${item.id}`,
                                kind: 'content_write',
                                state: isBlocked ? 'blocked' : 'available',
                                assignee_role: 'content_writer',
                                due_at: item.content_due_at || item.schedule_at || null,
                                reason_code: isBlocked ? 'SOURCE_UNAVAILABLE' : null,
                                missing_resource_refs: isBlocked ? missingRefs : undefined
                            }
                        });
                    }
                }
            } else {
                await tx.weekPackage.update({
                    where: { id: params.weekPackageId },
                    data: { approval_status: 'rejected' }
                });
            }

            const afterState = {
                week_package: {
                    id: params.weekPackageId,
                    approval_status: params.decision,
                    plan_version: params.planVersion
                },
                plan_version: params.planVersion,
                decision: params.decision,
                comment: params.comment || null
            };

            await recordWorkflowEvent(tx, {
                projectId: params.projectId,
                weekPackageId: params.weekPackageId,
                actorId: params.actorId,
                command: 'ba_decide_week_plan',
                beforeState,
                afterState,
                idempotencyKey: params.idempotencyKey
            });

            return afterState;
        });
    }

    /** Editor-only MCP route for the content_reviewer stage. It never touches copy. */
    async claimContentReview(params: {
        projectId: number; actorId: string; workItemId: number;
        expectedResultVersion: number; expectedContentRevision: number;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:claim');
            const command = 'ba_claim_content_review';
            const cached = await checkIdempotency(tx, {
                projectId: params.projectId, actorId: params.actorId,
                command, idempotencyKey: params.idempotencyKey
            });
            if (cached) {
                const lease = await tx.workItem.findFirst({ where: {
                    id: params.workItemId, project_id: params.projectId,
                    kind: 'content_review', assignee_role: 'content_reviewer',
                    state: 'claimed', lease_actor_id: params.actorId,
                    lease_expires_at: { gte: new Date() }
                } });
                const cachedResult = cached as { work_item?: { id?: number }; lease_token?: string };
                if (lease?.lease_token && cachedResult.work_item?.id === params.workItemId) {
                    return {
                        ...(cached as Record<string, unknown>),
                        lease_token: lease.lease_token,
                        lease_expires_at: lease.lease_expires_at!.toISOString()
                    };
                }
                throw new Error('[CONTENT_REVIEW_LEASE_EXPIRED] Idempotent claim has no active lease');
            }
            const item = await tx.workItem.findFirst({
                where: { id: params.workItemId, project_id: params.projectId },
                include: { content_item: true }
            });
            if (!item) throw new Error('[CONTENT_REVIEW_NOT_FOUND] Review work item not found');
            const now = new Date();
            const expiredClaim = item.state === 'claimed'
                && Boolean(item.lease_expires_at)
                && item.lease_expires_at! < now;
            assertContentReviewInput({
                kind: item.kind, assigneeRole: item.assignee_role,
                state: expiredClaim ? 'available' : item.state,
                resultVersion: item.result_version, expectedResultVersion: params.expectedResultVersion,
                contentRevision: item.content_item?.content_revision ?? null,
                expectedContentRevision: params.expectedContentRevision, phase: 'claim'
            });
            const leaseToken = `lease-${randomUUID()}`;
            const leaseExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
            const claimed = await tx.workItem.updateMany({
                where: {
                    id: item.id, project_id: params.projectId,
                    kind: 'content_review', assignee_role: 'content_reviewer',
                    state: expiredClaim ? 'claimed' : 'available',
                    result_version: params.expectedResultVersion,
                    ...(expiredClaim ? { lease_expires_at: { lt: now } } : {})
                },
                data: {
                    state: 'claimed', lease_token: leaseToken,
                    lease_expires_at: leaseExpiresAt, lease_actor_id: params.actorId
                }
            });
            if (claimed.count !== 1) throw new Error('[CONTENT_REVIEW_CLAIM_CONFLICT] Review was claimed concurrently');
            const result = {
                work_item: { id: item.id, state: 'claimed', result_version: item.result_version },
                lease_token: leaseToken, lease_expires_at: leaseExpiresAt.toISOString(),
                content_revision: params.expectedContentRevision
            };
            await recordWorkflowEvent(tx, {
                projectId: params.projectId, workItemId: item.id,
                actorId: params.actorId, command, idempotencyKey: params.idempotencyKey,
                beforeState: {
                    state: item.state,
                    result_version: item.result_version,
                    lease_actor_id: item.lease_actor_id,
                    lease_expires_at: item.lease_expires_at?.toISOString() || null,
                    expired_lease_recovered: expiredClaim
                },
                afterState: { work_item: result.work_item, lease_actor_id: params.actorId,
                    lease_expires_at: result.lease_expires_at,
                    expired_lease_recovered: expiredClaim }
            });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    /**
     * Submits a content review result with lease validation.
     */
    async submitContentReview(params: {
        projectId: number; actorId: string; workItemId: number;
        expectedResultVersion: number; expectedContentRevision: number;
        leaseToken: string;
        result: { recommendation: 'approve' | 'revise'; summary: string; findings?: string[] };
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:complete');
            const command = 'ba_submit_content_review';
            const cached = await checkIdempotency(tx, {
                projectId: params.projectId, actorId: params.actorId,
                command, idempotencyKey: params.idempotencyKey
            });
            if (cached) {
                const cachedResult = cached as { work_item?: { id?: number } };
                if (cachedResult.work_item?.id !== params.workItemId) {
                    throw new Error('[CONTENT_REVIEW_IDEMPOTENCY_CONFLICT] Key belongs to another review item');
                }
                return cached as Record<string, unknown>;
            }
            if (!params.result.summary.trim()) throw new Error('[CONTENT_REVIEW_RESULT_REQUIRED] Review summary is required');
            const item = await tx.workItem.findFirst({
                where: { id: params.workItemId, project_id: params.projectId },
                include: { content_item: true }
            });
            if (!item) throw new Error('[CONTENT_REVIEW_NOT_FOUND] Review work item not found');
            assertContentReviewInput({
                kind: item.kind, assigneeRole: item.assignee_role, state: item.state,
                resultVersion: item.result_version, expectedResultVersion: params.expectedResultVersion,
                contentRevision: item.content_item?.content_revision ?? null,
                expectedContentRevision: params.expectedContentRevision, phase: 'submit'
            });
            const now = new Date();
            if (item.lease_token !== params.leaseToken || item.lease_actor_id !== params.actorId
                || !item.lease_expires_at || item.lease_expires_at < now) {
                throw new Error('[CONTENT_REVIEW_INVALID_LEASE] Active reviewer-owned lease required');
            }
            const nextVersion = item.result_version + 1;
            const updated = await tx.workItem.updateMany({
                where: {
                    id: item.id, project_id: params.projectId,
                    kind: 'content_review', assignee_role: 'content_reviewer',
                    state: 'claimed', result_version: params.expectedResultVersion,
                    lease_token: params.leaseToken, lease_actor_id: params.actorId,
                    lease_expires_at: { gte: now }
                },
                data: {
                    state: 'waiting_approval', result_version: nextVersion,
                    result_payload: params.result as Prisma.InputJsonValue,
                    lease_token: null, lease_expires_at: null, lease_actor_id: null
                }
            });
            if (updated.count !== 1) throw new Error('[CONTENT_REVIEW_SUBMIT_CONFLICT] Review changed concurrently');
            const result = { work_item: { id: item.id, state: 'waiting_approval', result_version: nextVersion },
                content_revision: params.expectedContentRevision };
            await recordWorkflowEvent(tx, {
                projectId: params.projectId, workItemId: item.id,
                actorId: params.actorId, command, idempotencyKey: params.idempotencyKey,
                beforeState: { state: item.state, result_version: item.result_version },
                afterState: result
            });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    /**
     * Decides on approval for a work item's result version.
     */
    async decideApproval(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
        resultVersion: number;
        decision: 'approved' | 'rejected';
        comment?: string;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:decide');

            const cached = await checkIdempotency(tx, {
                projectId: params.projectId,
                actorId: params.actorId,
                command: 'ba_decide_approval',
                idempotencyKey: params.idempotencyKey
            });
            if (cached) return cached as Record<string, unknown>;

            const item = await tx.workItem.findFirst({
                where: {
                    id: params.workItemId,
                    project_id: params.projectId
                }
            });

            if (!item) {
                throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
            }

            if (item.kind === 'content_review' && (item.assignee_role !== 'content_reviewer'
                || item.state !== 'waiting_approval')) {
                throw new Error('[CONTENT_REVIEW_NOT_SUBMITTED] Review must be submitted before an approval decision');
            }

            if (item.result_version !== params.resultVersion) {
                throw new Error(`[STALE_RESULT_VERSION] Cannot decide on version ${params.resultVersion}; current item version is ${item.result_version}`);
            }

            if (params.decision === 'rejected' && (!params.comment || !params.comment.trim())) {
                throw new Error(`Comment is required when rejecting content`);
            }

            await tx.approvalDecision.create({
                data: {
                    work_item_id: params.workItemId,
                    result_version: params.resultVersion,
                    decision: params.decision,
                    actor_id: params.actorId,
                    comment: params.comment || null,
                    idempotency_key: params.idempotencyKey
                }
            });

            const updated = await tx.workItem.update({
                where: { id: params.workItemId },
                data: {
                    state: 'completed',
                    note: params.comment || undefined
                }
            });

            if (params.decision === 'approved' && item.content_item_id) {
                await tx.contentItem.update({
                    where: { id: item.content_item_id },
                    data: { status: 'approved' }
                });
                if (item.kind === 'content_review') {
                    await artDirectionService.acceptContentRevision(tx, item.content_item_id, params.actorId);
                }
            } else if (params.decision === 'rejected' && item.content_item_id) {
                await tx.workItem.create({
                    data: {
                        project_id: params.projectId,
                        week_package_id: item.week_package_id,
                        content_item_id: item.content_item_id,
                        item_key: item.item_key,
                        kind: 'content_write',
                        state: 'available',
                        assignee_role: 'content_writer',
                        input_context_version: item.input_context_version + 1,
                        note: params.comment,
                        due_at: item.due_at
                    }
                });
            }

            const afterState = {
                work_item: {
                    id: updated.id,
                    state: updated.state
                },
                approval: {
                    result_version: params.resultVersion,
                    decision: params.decision,
                    comment: params.comment || null
                }
            };

            await recordWorkflowEvent(tx, {
                projectId: params.projectId,
                workItemId: params.workItemId,
                actorId: params.actorId,
                command: 'ba_decide_approval',
                beforeState: { state: item.state },
                afterState,
                idempotencyKey: params.idempotencyKey
            });

            return afterState;
        });
    }
}

export default new WorkQueueService();
