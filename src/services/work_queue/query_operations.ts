import { Prisma } from '@prisma/client';
import prisma from '../../db';
import { requireProjectAccess } from './auth';

/**
 * Lists work items for a project filtered by state/kind and computes schedule health.
 */
export async function listWorkItems(params: {
    projectId: number;
    actorId: string;
    asOf?: string;
    filter?: { state?: string; kind?: string };
}): Promise<{ work_items: Record<string, unknown>[] }> {
    await requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

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
export async function getWorkItem(params: {
    projectId: number;
    actorId: string;
    workItemId: number;
}): Promise<{ work_item: Record<string, unknown> }> {
    await requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

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
export async function getWorkItemContext(params: {
    projectId: number;
    actorId: string;
    workItemId: number;
    maxChars?: number;
}): Promise<Record<string, unknown>> {
    await requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

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
 * Lists schedule exceptions for a project (overdue, publication_missed, SOURCE_UNAVAILABLE).
 */
export async function listScheduleExceptions(params: {
    projectId: number;
    actorId: string;
    asOf?: string;
    includeBlocked?: boolean;
}): Promise<{ exceptions: Record<string, unknown>[] }> {
    await requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

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
export async function getWeekExecutionSummary(params: {
    projectId: number;
    actorId: string;
    weekPackageId: number;
    asOf?: string;
}): Promise<Record<string, unknown>> {
    await requireProjectAccess(prisma, params.projectId, params.actorId, 'work_queue:read');

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
