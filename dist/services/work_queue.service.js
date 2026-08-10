"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkQueueService = void 0;
const crypto_1 = require("crypto");
const db_1 = __importDefault(require("../db"));
class WorkQueueService {
    /**
     * Verifies that the given actor has access to the project.
     * Throws an error if authorization fails.
     */
    async requireProjectAccess(projectId, actorId) {
        if (!actorId || typeof actorId !== 'string' || !actorId.trim()) {
            throw new Error(`[Security] Access denied: Actor ID is required`);
        }
        const project = await db_1.default.project.findUnique({
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
            const member = await db_1.default.projectMember.findUnique({
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
        // System or agent actor validation:
        // System actors must match known valid prefixes: 'system:', 'agent:', or 'tdpd-red-agent'
        const ALLOWED_SYSTEM_ACTOR_PREFIXES = ['system:', 'agent:', 'tdpd-red-agent'];
        const isKnownSystemActor = ALLOWED_SYSTEM_ACTOR_PREFIXES.some(prefix => actorId === prefix || actorId.startsWith(prefix));
        if (!isKnownSystemActor) {
            throw new Error(`[Security] Access denied: Unauthorized non-user actor "${actorId}"`);
        }
        // Verify project has valid active members
        const members = await db_1.default.projectMember.findMany({
            where: { project_id: projectId }
        });
        if (members.length === 0) {
            throw new Error(`[Security] Access denied: Project ${projectId} has no members for actor ${actorId}`);
        }
    }
    /**
     * Checks if a workflow event with the idempotency key exists and matches scope.
     * Enforces project + actor + command scoping as specified in TDPD-001 Section 10.
     */
    async checkIdempotency(params) {
        if (!params.idempotencyKey)
            return null;
        const existing = await db_1.default.workflowEvent.findFirst({
            where: { idempotency_key: params.idempotencyKey }
        });
        if (existing) {
            if (existing.project_id !== params.projectId ||
                existing.actor_id !== params.actorId ||
                existing.command !== params.command) {
                throw new Error(`[IDEMPOTENCY_CONFLICT] Idempotency key "${params.idempotencyKey}" was previously used with different command or scope`);
            }
            if (existing.after_state) {
                return existing.after_state;
            }
        }
        return null;
    }
    /**
     * Records a workflow audit event.
     */
    async recordWorkflowEvent(params) {
        await db_1.default.workflowEvent.create({
            data: {
                project_id: params.projectId,
                work_item_id: params.workItemId || null,
                week_package_id: params.weekPackageId || null,
                content_item_id: params.contentItemId || null,
                actor_id: params.actorId,
                command: params.command,
                before_state: params.beforeState ? params.beforeState : undefined,
                after_state: params.afterState ? params.afterState : undefined,
                idempotency_key: params.idempotencyKey || null
            }
        });
    }
    /**
     * Decides on a week plan (approves or rejects).
     * On approval, unlocks content_write work items for materials in the package.
     */
    async decideWeekPlan(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const cached = await this.checkIdempotency({
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_decide_week_plan',
            idempotencyKey: params.idempotencyKey
        });
        if (cached)
            return cached;
        const weekPackage = await db_1.default.weekPackage.findFirst({
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
        const beforeState = { approval_status: weekPackage.approval_status };
        if (params.decision === 'approved') {
            await db_1.default.weekPackage.update({
                where: { id: params.weekPackageId },
                data: {
                    approval_status: 'approved',
                    plan_version: params.planVersion
                }
            });
            // Mark plan_review work item as completed if present
            await db_1.default.workItem.updateMany({
                where: {
                    week_package_id: params.weekPackageId,
                    kind: 'plan_review'
                },
                data: { state: 'completed' }
            });
            // For each ContentItem, create or unlock its content_write WorkItem
            for (const item of weekPackage.content_items) {
                const existingWrite = await db_1.default.workItem.findFirst({
                    where: {
                        content_item_id: item.id,
                        kind: 'content_write'
                    }
                });
                if (!existingWrite) {
                    // Inspect source availability
                    const sourceRefs = Array.isArray(item.source_refs) ? item.source_refs : [];
                    const missingRefs = [];
                    for (const ref of sourceRefs) {
                        const pathVal = typeof ref === 'string' ? ref : (ref?.path || ref?.url_ref || '');
                        if (typeof pathVal === 'string' && pathVal.startsWith('/host-only')) {
                            missingRefs.push(pathVal);
                        }
                    }
                    const isBlocked = missingRefs.length > 0;
                    await db_1.default.workItem.create({
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
        }
        else {
            await db_1.default.weekPackage.update({
                where: { id: params.weekPackageId },
                data: { approval_status: 'rejected' }
            });
        }
        const afterState = {
            week_package: {
                id: params.weekPackageId,
                approval_status: params.decision
            },
            decision: params.decision
        };
        await this.recordWorkflowEvent({
            projectId: params.projectId,
            weekPackageId: params.weekPackageId,
            actorId: params.actorId,
            command: 'ba_decide_week_plan',
            beforeState,
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    }
    /**
     * Lists work items for a project filtered by state/kind and computes schedule health.
     */
    async listWorkItems(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const currentTime = params.asOf ? new Date(params.asOf) : new Date();
        const where = { project_id: params.projectId };
        if (params.filter?.state) {
            where.state = params.filter.state;
        }
        else {
            where.state = { in: ['available', 'claimed', 'blocked', 'waiting_approval'] };
        }
        if (params.filter?.kind) {
            where.kind = params.filter.kind;
        }
        const items = await db_1.default.workItem.findMany({
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
            if (item.state === 'available')
                nextAction = 'claim';
            else if (item.state === 'claimed')
                nextAction = 'complete';
            else if (item.state === 'waiting_approval')
                nextAction = 'decide_approval';
            else if (item.state === 'blocked')
                nextAction = 'resolve_blocker';
            const missingRefs = Array.isArray(item.missing_resource_refs) ? item.missing_resource_refs : [];
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
        // Sort: overdue first, then due_at ascending, then id
        mapped.sort((a, b) => {
            if (a.is_overdue && !b.is_overdue)
                return -1;
            if (!a.is_overdue && b.is_overdue)
                return 1;
            if (a.due_at && b.due_at) {
                return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
            }
            return a.id - b.id;
        });
        return { work_items: mapped };
    }
    /**
     * Gets a single work item by ID with full details.
     */
    async getWorkItem(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const item = await db_1.default.workItem.findFirst({
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
    async getWorkItemContext(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const item = await db_1.default.workItem.findFirst({
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
        // Fetch assets / snapshots from ProjectSettings
        const settings = await db_1.default.projectSettings.findMany({
            where: { project_id: params.projectId }
        });
        const assetsSetting = settings.find(s => s.key === 'publication_plan_assets');
        const snapshotsSetting = settings.find(s => s.key === 'publication_plan_asset_snapshots');
        const assetsPayload = assetsSetting ? JSON.parse(assetsSetting.value || '{}') : {};
        const snapshotsPayload = snapshotsSetting ? JSON.parse(snapshotsSetting.value || '{}') : {};
        let rawSourceRefs = [];
        if (item.content_item && item.content_item.source_refs) {
            rawSourceRefs = Array.isArray(item.content_item.source_refs) ? item.content_item.source_refs : [item.content_item.source_refs];
        }
        const resources = rawSourceRefs.map(ref => {
            const refKey = typeof ref === 'string' ? ref : (ref?.url_ref || ref?.path || '');
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
            }
            else if (Object.keys(assetsPayload).length > 0) {
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
     * Claims a work item with an atomic lease reservation.
     */
    async claimWorkItem(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const cached = await this.checkIdempotency({
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_claim_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached)
            return cached;
        const now = new Date();
        const leaseDuration = Math.min(Math.max(params.leaseSeconds || 1800, 60), 3600);
        const leaseToken = `lease-${(0, crypto_1.randomUUID)()}`;
        const leaseExpiresAt = new Date(now.getTime() + leaseDuration * 1000);
        // Atomic conditional update to prevent double-claim race conditions
        const updateResult = await db_1.default.workItem.updateMany({
            where: {
                id: params.workItemId,
                project_id: params.projectId,
                OR: [
                    { state: 'available' },
                    { lease_expires_at: { lt: now } },
                    { lease_actor_id: params.actorId }
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
            const existing = await db_1.default.workItem.findFirst({
                where: { id: params.workItemId, project_id: params.projectId }
            });
            if (!existing) {
                throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
            }
            throw new Error(`[WORK_ITEM_ALREADY_CLAIMED] Work item ${params.workItemId} is currently claimed by ${existing.lease_actor_id || 'another actor'}`);
        }
        const updated = await db_1.default.workItem.findUniqueOrThrow({
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
        await this.recordWorkflowEvent({
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_claim_work_item',
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    }
    /**
     * Completes a work item execution and unlocks the next stage.
     * Strictly validates project, active claim state, and lease token.
     */
    async completeWorkItem(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const cached = await this.checkIdempotency({
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_complete_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached)
            return cached;
        const now = new Date();
        const item = await db_1.default.workItem.findFirst({
            where: {
                id: params.workItemId,
                project_id: params.projectId
            }
        });
        if (!item) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }
        // Strict lease validation: work item MUST be in 'claimed' state with matching lease token
        if (item.state !== 'claimed' || !item.lease_token || item.lease_token !== params.leaseToken) {
            throw new Error(`[INVALID_LEASE_TOKEN] Valid active lease token is required to complete work item ${params.workItemId}`);
        }
        if (item.lease_expires_at && now.getTime() > item.lease_expires_at.getTime()) {
            throw new Error(`[LEASE_EXPIRED] Lease token for work item ${params.workItemId} has expired`);
        }
        const newResultVersion = item.result_version + 1;
        const updated = await db_1.default.workItem.update({
            where: { id: params.workItemId },
            data: {
                state: 'completed',
                result_version: newResultVersion,
                result_payload: params.result,
                lease_token: null,
                lease_expires_at: null,
                lease_actor_id: null
            }
        });
        if (item.content_item_id) {
            await db_1.default.contentItem.update({
                where: { id: item.content_item_id },
                data: {
                    draft_text: params.result.body || params.result.text || '',
                    status: 'drafted'
                }
            });
            // Unlock content_review WorkItem
            const existingReview = await db_1.default.workItem.findFirst({
                where: {
                    content_item_id: item.content_item_id,
                    kind: 'content_review'
                }
            });
            if (!existingReview) {
                await db_1.default.workItem.create({
                    data: {
                        project_id: params.projectId,
                        week_package_id: item.week_package_id,
                        content_item_id: item.content_item_id,
                        item_key: item.item_key,
                        kind: 'content_review',
                        state: 'available',
                        assignee_role: 'content_reviewer',
                        result_version: newResultVersion,
                        due_at: item.due_at
                    }
                });
            }
            else {
                await db_1.default.workItem.update({
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
                id: updated.id,
                state: updated.state
            },
            result_version: newResultVersion
        };
        await this.recordWorkflowEvent({
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_complete_work_item',
            beforeState: { state: item.state },
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    }
    /**
     * Decides on approval for a work item's result version.
     */
    async decideApproval(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const cached = await this.checkIdempotency({
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_decide_approval',
            idempotencyKey: params.idempotencyKey
        });
        if (cached)
            return cached;
        const item = await db_1.default.workItem.findFirst({
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
        await db_1.default.approvalDecision.create({
            data: {
                work_item_id: params.workItemId,
                result_version: params.resultVersion,
                decision: params.decision,
                actor_id: params.actorId,
                comment: params.comment || null,
                idempotency_key: params.idempotencyKey
            }
        });
        const updated = await db_1.default.workItem.update({
            where: { id: params.workItemId },
            data: {
                state: 'completed',
                note: params.comment || undefined
            }
        });
        if (params.decision === 'approved' && item.content_item_id) {
            await db_1.default.contentItem.update({
                where: { id: item.content_item_id },
                data: { status: 'approved' }
            });
        }
        else if (params.decision === 'rejected' && item.content_item_id) {
            // Re-open content_write for revision
            await db_1.default.workItem.create({
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
        await this.recordWorkflowEvent({
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_decide_approval',
            beforeState: { state: item.state },
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    }
    /**
     * Lists schedule exceptions for a project (overdue, publication_missed, SOURCE_UNAVAILABLE).
     */
    async listScheduleExceptions(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const currentTime = params.asOf ? new Date(params.asOf) : new Date();
        const workItems = await db_1.default.workItem.findMany({
            where: { project_id: params.projectId },
            include: { content_item: true }
        });
        const contentItems = await db_1.default.contentItem.findMany({
            where: { project_id: params.projectId }
        });
        const exceptions = [];
        // 1. Blocked items (if includeBlocked is true)
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
        // 2. ContentItems schedule health (publication_missed vs content_overdue)
        for (const contentItem of contentItems) {
            if (contentItem.status === 'published')
                continue;
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
            }
            else if (dueAt && currentTime.getTime() > new Date(dueAt).getTime()) {
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
    async getWeekExecutionSummary(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const items = await db_1.default.workItem.findMany({
            where: {
                project_id: params.projectId,
                week_package_id: params.weekPackageId
            }
        });
        const contentItems = await db_1.default.contentItem.findMany({
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
     * Blocks a work item manually. Strictly verifies project membership, claimed state, and active lease token.
     */
    async blockWorkItem(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const cached = await this.checkIdempotency({
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_block_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached)
            return cached;
        const item = await db_1.default.workItem.findFirst({
            where: {
                id: params.workItemId,
                project_id: params.projectId
            }
        });
        if (!item) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }
        const now = new Date();
        if (item.state !== 'claimed' || !item.lease_token || item.lease_token !== params.leaseToken) {
            throw new Error(`[INVALID_LEASE_TOKEN] Valid active lease token is required to block work item ${params.workItemId}`);
        }
        if (item.lease_expires_at && now.getTime() > item.lease_expires_at.getTime()) {
            throw new Error(`[LEASE_EXPIRED] Lease token for work item ${params.workItemId} has expired`);
        }
        const updated = await db_1.default.workItem.update({
            where: { id: params.workItemId },
            data: {
                state: 'blocked',
                reason_code: params.reasonCode,
                note: params.note || undefined,
                lease_token: null,
                lease_expires_at: null,
                lease_actor_id: null
            }
        });
        const afterState = { work_item: { id: updated.id, state: updated.state } };
        await this.recordWorkflowEvent({
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_block_work_item',
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    }
    /**
     * Releases a claimed work item lease back to the available queue.
     * Strictly verifies project membership, claimed state, and active lease token.
     */
    async releaseWorkItem(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const cached = await this.checkIdempotency({
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_release_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached)
            return cached;
        const item = await db_1.default.workItem.findFirst({
            where: {
                id: params.workItemId,
                project_id: params.projectId
            }
        });
        if (!item) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }
        const now = new Date();
        if (item.state !== 'claimed' || !item.lease_token || item.lease_token !== params.leaseToken) {
            throw new Error(`[INVALID_LEASE_TOKEN] Valid active lease token is required to release work item ${params.workItemId}`);
        }
        if (item.lease_expires_at && now.getTime() > item.lease_expires_at.getTime()) {
            throw new Error(`[LEASE_EXPIRED] Lease token for work item ${params.workItemId} has expired`);
        }
        const updated = await db_1.default.workItem.update({
            where: { id: params.workItemId },
            data: {
                state: 'available',
                lease_token: null,
                lease_expires_at: null,
                lease_actor_id: null
            }
        });
        const afterState = { work_item: { id: updated.id, state: updated.state } };
        await this.recordWorkflowEvent({
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_release_work_item',
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    }
    /**
     * Reschedules a work item due date with audit reason.
     * Strictly verifies project membership and work item ownership.
     */
    async rescheduleWorkItem(params) {
        await this.requireProjectAccess(params.projectId, params.actorId);
        const cached = await this.checkIdempotency({
            projectId: params.projectId,
            actorId: params.actorId,
            command: 'ba_reschedule_work_item',
            idempotencyKey: params.idempotencyKey
        });
        if (cached)
            return cached;
        const item = await db_1.default.workItem.findFirst({
            where: {
                id: params.workItemId,
                project_id: params.projectId
            }
        });
        if (!item) {
            throw new Error(`WorkItem ${params.workItemId} not found in project ${params.projectId}`);
        }
        const updated = await db_1.default.workItem.update({
            where: { id: params.workItemId },
            data: {
                due_at: new Date(params.dueAt),
                note: params.reason
            }
        });
        const afterState = { work_item: { id: updated.id, due_at: updated.due_at?.toISOString() } };
        await this.recordWorkflowEvent({
            projectId: params.projectId,
            workItemId: params.workItemId,
            actorId: params.actorId,
            command: 'ba_reschedule_work_item',
            beforeState: { due_at: item.due_at?.toISOString() },
            afterState,
            idempotencyKey: params.idempotencyKey
        });
        return afterState;
    }
}
exports.WorkQueueService = WorkQueueService;
exports.default = new WorkQueueService();
