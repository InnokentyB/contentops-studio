import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import artDirectionService from './art_direction.service';
import { planContentReviewRecovery } from './publication_content_revision_lifecycle';

/**
 * Scopes for work queue operations.
 */
export type WorkQueueScope =
    | 'work_queue:read'
    | 'work_queue:claim'
    | 'work_queue:complete'
    | 'work_queue:block'
    | 'work_queue:release'
    | 'work_queue:decide'
    | 'work_queue:reschedule';

interface RegisteredServiceIdentity {
    actorId: string;
    name: string;
    scopes: WorkQueueScope[];
}

/**
 * Registry of authorized service identities and their granted scopes.
 */
const REGISTERED_SERVICE_IDENTITIES: Record<string, RegisteredServiceIdentity> = {
    'system:planner': {
        actorId: 'system:planner',
        name: 'System Content Planner',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    },
    'system:mcp': {
        actorId: 'system:mcp',
        name: 'MCP Server System',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    },
    'system:orchestrator': {
        actorId: 'system:orchestrator',
        name: 'Media Orchestrator Engine',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    },
    'agent:content_writer': {
        actorId: 'agent:content_writer',
        name: 'Content Writer Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release']
    },
    'agent:content_reviewer': {
        actorId: 'agent:content_reviewer',
        name: 'Content Reviewer Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:decide']
    },
    'agent:plan_reviewer': {
        actorId: 'agent:plan_reviewer',
        name: 'Plan Reviewer Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:decide']
    },
    'agent:art_director': {
        actorId: 'agent:art_director',
        name: 'Art Director Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide']
    },
    'tdpd-red-agent': {
        actorId: 'tdpd-red-agent',
        name: 'TDPD Red Test Runner Agent',
        scopes: ['work_queue:read', 'work_queue:claim', 'work_queue:complete', 'work_queue:block', 'work_queue:release', 'work_queue:decide', 'work_queue:reschedule']
    }
};

export class WorkQueueService {
    async recoverContentReview(params: {
        projectId: number;
        actorId: string;
        taskId: number;
        workItemId: number;
        expectedContentRevision: number;
        idempotencyKey: string;
        evidence?: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectOwner(tx, params.projectId, params.actorId);
            const command = 'ba_recover_content_review';
            const cached = await this.checkIdempotency(tx, {
                projectId: params.projectId,
                actorId: params.actorId,
                command,
                idempotencyKey: params.idempotencyKey
            });
            if (cached) return cached as Record<string, unknown>;

            const content = await tx.contentItem.findFirst({
                where: { id: params.taskId, project_id: params.projectId }
            });
            const review = await tx.workItem.findFirst({
                where: {
                    id: params.workItemId,
                    project_id: params.projectId,
                    content_item_id: params.taskId,
                    kind: 'content_review'
                }
            });
            if (!content) throw new Error(`Publication task ${params.taskId} not found for project ${params.projectId}`);
            if (!review) throw new Error(`Content review work item ${params.workItemId} not found for publication task ${params.taskId}`);
            if (content.content_revision !== params.expectedContentRevision) {
                throw new Error(`[CONTENT_REVISION_CONFLICT] Expected revision ${params.expectedContentRevision}; current revision is ${content.content_revision}`);
            }

            const currentApproval = await tx.approvalDecision.findUnique({
                where: {
                    work_item_id_result_version: {
                        work_item_id: review.id,
                        result_version: content.content_revision
                    }
                }
            });
            const lifecycle = planContentReviewRecovery({
                contentRevision: content.content_revision,
                acceptedRevision: content.accepted_revision,
                textState: content.text_state,
                reviewResultVersion: review.result_version,
                currentRevisionAlreadyApproved: currentApproval?.decision === 'approved'
            });
            const beforeState = {
                content_revision: content.content_revision,
                accepted_revision: content.accepted_revision,
                text_state: content.text_state,
                review_result_version: review.result_version,
                review_state: review.state
            };

            if (lifecycle.needsRecovery) {
                await tx.contentItem.update({
                    where: { id: content.id },
                    data: {
                        text_state: lifecycle.textState,
                        accepted_revision: lifecycle.acceptedRevision
                    }
                });
                await tx.workItem.update({
                    where: { id: review.id },
                    data: {
                        state: lifecycle.reviewState,
                        input_context_version: content.content_revision,
                        result_version: lifecycle.reviewResultVersion,
                        result_payload: {
                            recovered_content_revision: content.content_revision,
                            body: content.draft_text,
                            evidence: params.evidence || null
                        },
                        lease_token: null,
                        lease_expires_at: null,
                        lease_actor_id: null,
                        note: params.evidence || `Recovered review result for content revision ${content.content_revision}`
                    }
                });
            }

            const afterState = {
                recovered: lifecycle.needsRecovery,
                task_id: content.id,
                content_revision: content.content_revision,
                accepted_revision: lifecycle.acceptedRevision,
                text_state: lifecycle.textState,
                work_item_id: review.id,
                review_result_version: lifecycle.reviewResultVersion,
                review_state: lifecycle.reviewState
            };
            await this.recordWorkflowEvent(tx, {
                projectId: params.projectId,
                workItemId: review.id,
                weekPackageId: review.week_package_id || undefined,
                contentItemId: content.id,
                actorId: params.actorId,
                command,
                beforeState,
                afterState,
                idempotencyKey: params.idempotencyKey
            });
            return afterState;
        });
    }

    private async requireProjectOwner(
        client: Prisma.TransactionClient | typeof prisma,
        projectId: number,
        actorId: string
    ): Promise<number> {
        const match = /^user:(\d+)$/.exec(actorId);
        if (!match) {
            throw new Error('[Security] Access denied: Project owner user actor is required');
        }

        const userId = Number(match[1]);
        const membership = await client.projectMember.findUnique({
            where: {
                project_id_user_id: {
                    project_id: projectId,
                    user_id: userId
                }
            }
        });

        if (!membership || membership.role !== 'owner') {
            throw new Error('[Security] Access denied: Project owner role is required to manage service identity bindings');
        }

        return userId;
    }

    async bindServiceIdentity(params: {
        projectId: number;
        actorId: string;
        serviceActorId: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectOwner(tx, params.projectId, params.actorId);
            const identity = REGISTERED_SERVICE_IDENTITIES[params.serviceActorId];
            if (!identity) {
                throw new Error(`[Security] Access denied: Actor "${params.serviceActorId}" is not a registered service identity`);
            }

            const binding = await tx.serviceIdentityBinding.upsert({
                where: {
                    project_id_actor_id: {
                        project_id: params.projectId,
                        actor_id: params.serviceActorId
                    }
                },
                update: { is_active: true },
                create: {
                    project_id: params.projectId,
                    actor_id: params.serviceActorId,
                    is_active: true
                }
            });

            await this.recordWorkflowEvent(tx, {
                projectId: params.projectId,
                actorId: params.actorId,
                command: 'ba_bind_service_identity',
                afterState: { service_actor_id: binding.actor_id, is_active: binding.is_active }
            });

            return {
                binding: {
                    actor_id: binding.actor_id,
                    name: identity.name,
                    scopes: identity.scopes,
                    is_active: binding.is_active
                }
            };
        });
    }

    async unbindServiceIdentity(params: {
        projectId: number;
        actorId: string;
        serviceActorId: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectOwner(tx, params.projectId, params.actorId);
            const existing = await tx.serviceIdentityBinding.findUnique({
                where: {
                    project_id_actor_id: {
                        project_id: params.projectId,
                        actor_id: params.serviceActorId
                    }
                }
            });
            if (!existing) {
                throw new Error(`Service identity binding for "${params.serviceActorId}" was not found in project ${params.projectId}`);
            }

            const binding = await tx.serviceIdentityBinding.update({
                where: { id: existing.id },
                data: { is_active: false }
            });

            await this.recordWorkflowEvent(tx, {
                projectId: params.projectId,
                actorId: params.actorId,
                command: 'ba_unbind_service_identity',
                beforeState: { service_actor_id: binding.actor_id, is_active: true },
                afterState: { service_actor_id: binding.actor_id, is_active: false }
            });

            return { binding: { actor_id: binding.actor_id, is_active: binding.is_active } };
        });
    }

    async listServiceBindings(params: {
        projectId: number;
        actorId: string;
    }): Promise<{ bindings: Record<string, unknown>[] }> {
        await this.requireProjectOwner(prisma, params.projectId, params.actorId);
        const bindings = await prisma.serviceIdentityBinding.findMany({
            where: { project_id: params.projectId },
            orderBy: { actor_id: 'asc' }
        });

        return {
            bindings: bindings.map((binding) => {
                const identity = REGISTERED_SERVICE_IDENTITIES[binding.actor_id];
                return {
                    actor_id: binding.actor_id,
                    name: identity?.name || binding.actor_id,
                    scopes: identity?.scopes || [],
                    is_active: binding.is_active,
                    updated_at: binding.updated_at.toISOString()
                };
            })
        };
    }

    /**
     * Verifies that the given actor is registered, has required scope, and has access to the project.
     * Throws an error if authorization fails.
     */
    private async requireProjectAccess(
        client: Prisma.TransactionClient | typeof prisma,
        projectId: number,
        actorId: string,
        requiredScope?: WorkQueueScope
    ): Promise<void> {
        if (!actorId || typeof actorId !== 'string' || !actorId.trim()) {
            throw new Error(`[Security] Access denied: Actor ID is required`);
        }

        const project = await client.project.findUnique({
            where: { id: projectId }
        });
        if (!project) {
            throw new Error(`[Security] Access denied: Project ${projectId} does not exist`);
        }

        if (actorId.startsWith('user:')) {
            const parsedUserId = Number(actorId.split(':')[1]);
            if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
                throw new Error(`[Security] Access denied: Invalid user actor ID format "${actorId}"`);
            }

            const member = await client.projectMember.findUnique({
                where: {
                    project_id_user_id: {
                        project_id: projectId,
                        user_id: parsedUserId
                    }
                }
            });

            if (!member) {
                throw new Error(`[Security] Access denied: actor ${actorId} does not have access to project ${projectId}`);
            }
            return;
        }

        // Service / Agent actor identity validation
        const registeredIdentity = REGISTERED_SERVICE_IDENTITIES[actorId];
        if (!registeredIdentity) {
            throw new Error(`[Security] Access denied: Actor "${actorId}" is not a registered service identity`);
        }

        if (requiredScope && !registeredIdentity.scopes.includes(requiredScope)) {
            throw new Error(`[Security] Access denied: Actor "${actorId}" lacks required scope "${requiredScope}"`);
        }

        const binding = await client.serviceIdentityBinding.findUnique({
            where: {
                project_id_actor_id: {
                    project_id: projectId,
                    actor_id: actorId
                }
            }
        });

        if (!binding || !binding.is_active) {
            throw new Error(`[Security] Access denied: Service identity "${actorId}" has no active project binding for project ${projectId}`);
        }
    }

    /**
     * Shared authorization boundary for adjacent MCP workflow services.
     * Keeps project membership and service-identity binding checks in one place.
     */
    async assertProjectAccess(
        client: Prisma.TransactionClient | typeof prisma,
        projectId: number,
        actorId: string,
        requiredScope?: WorkQueueScope
    ): Promise<void> {
        await this.requireProjectAccess(client, projectId, actorId, requiredScope);
    }

    /**
     * Checks if a workflow event with the idempotency key exists and matches composite scope.
     * Enforces project + actor + command scoping as specified in TDPD-001 Section 10.
     */
    private async checkIdempotency(
        client: Prisma.TransactionClient | typeof prisma,
        params: {
            projectId: number;
            actorId: string;
            command: string;
            idempotencyKey?: string;
        }
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
    private async recordWorkflowEvent(
        client: Prisma.TransactionClient | typeof prisma,
        params: {
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
            await this.requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:decide');

            const cached = await this.checkIdempotency(tx, {
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
            const replayAfterLock = await this.checkIdempotency(tx, {
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

            await this.recordWorkflowEvent(tx, {
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

    /**
     * Lists work items for a project filtered by state/kind and computes schedule health.
     */
    async listWorkItems(params: {
        projectId: number;
        actorId: string;
        asOf?: string;
        filter?: { state?: string; kind?: string };
    }): Promise<{ work_items: Record<string, unknown>[] }> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

        const currentTime = params.asOf ? new Date(params.asOf) : new Date();
        const where: Prisma.WorkItemWhereInput = { project_id: params.projectId };

        if (params.filter?.state) {
            where.state = params.filter.state;
        } else {
            where.state = { in: ['available', 'claimed', 'blocked', 'waiting_approval'] };
        }

        if (params.filter?.kind) {
            where.kind = params.filter.kind;
        }

        const items = await prisma.workItem.findMany({
            where,
            include: {
                content_item: true,
                week_package: true
            }
        });

        const mapped = items.map((item) => {
            const dueAt = item.due_at ? new Date(item.due_at) : null;
            const isOverdue = !!(dueAt && currentTime.getTime() > dueAt.getTime() && item.state !== 'completed' && item.state !== 'cancelled');
            const overdueSeconds = isOverdue && dueAt ? Math.floor((currentTime.getTime() - dueAt.getTime()) / 1000) : 0;

            let scheduleHealth = 'unscheduled';
            if (dueAt) {
                scheduleHealth = isOverdue ? 'overdue' : 'on_track';
            }

            let reasonCode = item.reason_code || null;
            if (isOverdue && !reasonCode) {
                reasonCode = item.kind === 'content_write' ? 'content_overdue' : 'review_overdue';
            }

            let nextAction = 'none';
            if (item.state === 'available') nextAction = 'claim';
            else if (item.state === 'claimed') nextAction = 'complete';
            else if (item.state === 'waiting_approval') nextAction = 'decide_approval';
            else if (item.state === 'blocked') nextAction = 'resolve_blocker';

            const missingRefs = Array.isArray(item.missing_resource_refs) ? (item.missing_resource_refs as string[]) : [];

            return {
                id: item.id,
                project_id: item.project_id,
                week_package_id: item.week_package_id,
                content_item_id: item.content_item_id,
                item_key: item.item_key,
                kind: item.kind,
                state: item.state,
                assignee_role: item.assignee_role,
                due_at: item.due_at ? item.due_at.toISOString() : null,
                schedule_health: scheduleHealth,
                is_overdue: isOverdue,
                overdue_seconds: overdueSeconds,
                reason_code: reasonCode,
                next_action: nextAction,
                missing_resource_refs: missingRefs.length > 0 ? missingRefs : undefined,
                result_version: item.result_version,
                input_context_version: item.input_context_version
            };
        });

        mapped.sort((a, b) => {
            if (a.is_overdue && !b.is_overdue) return -1;
            if (!a.is_overdue && b.is_overdue) return 1;
            if (a.due_at && b.due_at) {
                return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
            }
            return (a.id as number) - (b.id as number);
        });

        return { work_items: mapped };
    }

    /**
     * Gets a single work item by ID with full details.
     */
    async getWorkItem(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
    }): Promise<{ work_item: Record<string, unknown> }> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

        const item = await prisma.workItem.findFirst({
            where: {
                id: params.workItemId,
                project_id: params.projectId
            },
            include: {
                content_item: true,
                approval_decisions: {
                    orderBy: { id: 'desc' },
                    take: 1
                }
            }
        });

        if (!item) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }

        const latestApproval = item.approval_decisions[0];

        return {
            work_item: {
                id: item.id,
                project_id: item.project_id,
                week_package_id: item.week_package_id,
                content_item_id: item.content_item_id,
                item_key: item.item_key,
                kind: item.kind,
                state: item.state,
                assignee_role: item.assignee_role,
                due_at: item.due_at ? item.due_at.toISOString() : null,
                result_version: item.result_version,
                input_context_version: item.input_context_version,
                approval: latestApproval ? {
                    result_version: latestApproval.result_version,
                    decision: latestApproval.decision,
                    comment: latestApproval.comment
                } : undefined
            }
        };
    }

    /**
     * Gets work item execution context including week frame and resolved resources.
     */
    async getWorkItemContext(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
        maxChars?: number;
    }): Promise<Record<string, unknown>> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

        const item = await prisma.workItem.findFirst({
            where: {
                id: params.workItemId,
                project_id: params.projectId
            },
            include: {
                content_item: true,
                week_package: true
            }
        });

        if (!item) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }

        const settings = await prisma.projectSettings.findMany({
            where: { project_id: params.projectId }
        });

        const assetsSetting = settings.find(s => s.key === 'publication_plan_assets');
        const snapshotsSetting = settings.find(s => s.key === 'publication_plan_asset_snapshots');

        const assetsPayload = assetsSetting ? JSON.parse(assetsSetting.value || '{}') : {};
        const snapshotsPayload = snapshotsSetting ? JSON.parse(snapshotsSetting.value || '{}') : {};

        let rawSourceRefs: unknown[] = [];
        if (item.content_item && item.content_item.source_refs) {
            rawSourceRefs = Array.isArray(item.content_item.source_refs) ? item.content_item.source_refs : [item.content_item.source_refs];
        }

        const resources = rawSourceRefs.map(ref => {
            const refKey = typeof ref === 'string' ? ref : ((ref as { url_ref?: string; path?: string })?.url_ref || (ref as { url_ref?: string; path?: string })?.path || '');
            if (refKey && snapshotsPayload[refKey]) {
                return snapshotsPayload[refKey];
            }
            if (refKey && assetsPayload[refKey]) {
                return assetsPayload[refKey];
            }
            return ref;
        });

        if (resources.length === 0) {
            if (snapshotsPayload.inline_source) {
                resources.push(snapshotsPayload.inline_source);
            } else if (Object.keys(assetsPayload).length > 0) {
                resources.push(assetsPayload);
            }
        }

        return {
            week: {
                frame: item.week_package?.week_theme || '',
                thesis: item.week_package?.core_thesis || ''
            },
            content_item: {
                id: item.content_item?.id,
                title: item.content_item?.title,
                item_key: item.content_item?.item_key
            },
            resources
        };
    }

    /**
     * Claims a work item with an atomic conditional lease reservation.
     */
    async claimWorkItem(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
        leaseSeconds?: number;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:claim');

            const cached = await this.checkIdempotency(tx, {
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

            await this.recordWorkflowEvent(tx, {
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
    async completeWorkItem(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
        leaseToken: string;
        result: { body?: string; text?: string; format?: string };
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:complete');

            const cached = await this.checkIdempotency(tx, {
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

            await this.recordWorkflowEvent(tx, {
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
            await this.requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:decide');

            const cached = await this.checkIdempotency(tx, {
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

            await this.recordWorkflowEvent(tx, {
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

    /**
     * Lists schedule exceptions for a project (overdue, publication_missed, SOURCE_UNAVAILABLE).
     */
    async listScheduleExceptions(params: {
        projectId: number;
        actorId: string;
        asOf?: string;
        includeBlocked?: boolean;
    }): Promise<{ exceptions: Record<string, unknown>[] }> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

        const currentTime = params.asOf ? new Date(params.asOf) : new Date();

        const workItems = await prisma.workItem.findMany({
            where: { project_id: params.projectId },
            include: { content_item: true }
        });

        const contentItems = await prisma.contentItem.findMany({
            where: { project_id: params.projectId }
        });

        const exceptions: Record<string, unknown>[] = [];

        if (params.includeBlocked) {
            for (const item of workItems) {
                if (item.state === 'blocked') {
                    exceptions.push({
                        work_item_id: item.id,
                        content_item_id: item.content_item_id,
                        item_key: item.item_key,
                        reason_code: item.reason_code || 'SOURCE_UNAVAILABLE',
                        missing_resource_refs: Array.isArray(item.missing_resource_refs) ? item.missing_resource_refs : []
                    });
                }
            }
        }

        for (const contentItem of contentItems) {
            if (contentItem.status === 'published') continue;

            const itemKey = contentItem.item_key || `item-${contentItem.id}`;
            const pubAt = contentItem.publish_at || contentItem.schedule_at;
            const dueAt = contentItem.content_due_at || pubAt;

            const relatedWorkItem = workItems.find(w => w.content_item_id === contentItem.id && w.state !== 'completed');

            if (pubAt && currentTime.getTime() > new Date(pubAt).getTime()) {
                exceptions.push({
                    work_item_id: relatedWorkItem?.id || null,
                    content_item_id: contentItem.id,
                    item_key: itemKey,
                    reason_code: 'publication_missed',
                    due_at: new Date(pubAt).toISOString()
                });
            } else if (dueAt && currentTime.getTime() > new Date(dueAt).getTime()) {
                exceptions.push({
                    work_item_id: relatedWorkItem?.id || null,
                    content_item_id: contentItem.id,
                    item_key: itemKey,
                    reason_code: 'content_overdue',
                    due_at: new Date(dueAt).toISOString(),
                    overdue_seconds: Math.floor((currentTime.getTime() - new Date(dueAt).getTime()) / 1000)
                });
            }
        }

        return { exceptions };
    }

    /**
     * Returns week execution summary statistics for a week package.
     */
    async getWeekExecutionSummary(params: {
        projectId: number;
        actorId: string;
        weekPackageId: number;
        asOf?: string;
    }): Promise<Record<string, unknown>> {
        await this.requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

        const items = await prisma.workItem.findMany({
            where: {
                project_id: params.projectId,
                week_package_id: params.weekPackageId
            }
        });

        const contentItems = await prisma.contentItem.findMany({
            where: {
                project_id: params.projectId,
                week_package_id: params.weekPackageId
            }
        });

        const writeItems = items.filter(i => i.kind === 'content_write');
        const reviewItems = items.filter(i => i.kind === 'content_review');

        return {
            materials: {
                total: contentItems.length,
                with_next_action: items.filter(i => i.state === 'available' || i.state === 'blocked').length
            },
            work_items: {
                content_write: {
                    total: writeItems.length,
                    available: writeItems.filter(i => i.state === 'available').length,
                    blocked: writeItems.filter(i => i.state === 'blocked').length,
                    completed: writeItems.filter(i => i.state === 'completed').length
                },
                content_review: {
                    total: reviewItems.length,
                    available: reviewItems.filter(i => i.state === 'available').length,
                    completed: reviewItems.filter(i => i.state === 'completed').length
                }
            }
        };
    }

    /**
     * Blocks a work item manually using atomic conditional UPDATE.
     */
    async blockWorkItem(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
        leaseToken: string;
        reasonCode: string;
        note?: string;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:block');

            const cached = await this.checkIdempotency(tx, {
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
            await this.recordWorkflowEvent(tx, {
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
     */
    async releaseWorkItem(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
        leaseToken: string;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:release');

            const cached = await this.checkIdempotency(tx, {
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
            await this.recordWorkflowEvent(tx, {
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
     */
    async rescheduleWorkItem(params: {
        projectId: number;
        actorId: string;
        workItemId: number;
        dueAt: string;
        reason: string;
        idempotencyKey: string;
    }): Promise<Record<string, unknown>> {
        return prisma.$transaction(async (tx) => {
            await this.requireProjectAccess(tx, params.projectId, params.actorId, 'work_queue:reschedule');

            const cached = await this.checkIdempotency(tx, {
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
            await this.recordWorkflowEvent(tx, {
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
}

export default new WorkQueueService();
