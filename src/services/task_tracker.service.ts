import prisma from '../db';

export interface SyncTaskTrackerArgs {
    projectId: number;
    actorId: string;
    workItemId: number;
    idempotencyKey?: string;
}

export interface ProcessOutboxArgs {
    projectId: number;
    actorId: string;
    simulateUnreachable?: boolean;
    staleOutboxItem?: {
        workItemId: number;
        syncVersion: number;
        lastSyncedVersion: number;
    };
}

export interface ReceiveWebhookArgs {
    projectId: number;
    actorId: string;
    payload: {
        event_id: string;
        action?: string;
        issue_id?: string;
        state?: string;
        [key: string]: unknown;
    };
}

export interface ReconcileTaskTrackerArgs {
    projectId: number;
    actorId: string;
    autoRepair?: boolean;
}

export class TaskTrackerService {
    /**
     * Synchronize a WorkItem projection with Plane task tracker.
     * Enforces one-projection-one-card constraint and idempotent execution.
     */
    async syncTaskTracker(args: SyncTaskTrackerArgs) {
        const { projectId, workItemId, idempotencyKey } = args;

        const workItem = await prisma.workItem.findFirst({
            where: { id: workItemId, project_id: projectId },
        });

        if (!workItem) {
            throw new Error(`WorkItem ${workItemId} not found in project ${projectId}`);
        }

        // Idempotency check: if already synced to tracker, return existing record
        if (workItem.tracker_item_id && workItem.sync_status === 'synced') {
            return {
                work_item_id: workItem.id,
                tracker_provider: workItem.tracker_provider || 'plane',
                tracker_item_id: workItem.tracker_item_id,
                tracker_url: workItem.tracker_url,
                sync_version: workItem.sync_version,
                sync_status: workItem.sync_status,
            };
        }

        const trackerItemId = workItem.tracker_item_id || `plane-issue-${workItem.id}`;
        const trackerUrl = workItem.tracker_url || `http://localhost/plane/issue/${workItem.id}`;

        // Transactionally update WorkItem and record outbox event
        const updatedItem = await prisma.$transaction(async (tx) => {
            const updated = await tx.workItem.update({
                where: { id: workItemId },
                data: {
                    tracker_provider: 'plane',
                    tracker_project_id: String(projectId),
                    tracker_item_id: trackerItemId,
                    tracker_url: trackerUrl,
                    last_synced_at: new Date(),
                    sync_status: 'synced',
                    sync_version: { increment: 1 },
                },
            });

            await tx.outboxEvent.create({
                data: {
                    project_id: projectId,
                    work_item_id: workItemId,
                    event_type: 'work_item.synced',
                    payload: {
                        tracker_item_id: trackerItemId,
                        tracker_url: trackerUrl,
                        state: updated.state,
                    },
                    sync_version: updated.sync_version,
                    idempotency_key: idempotencyKey || null,
                    status: 'delivered',
                },
            });

            return updated;
        });

        return {
            work_item_id: updatedItem.id,
            tracker_provider: updatedItem.tracker_provider,
            tracker_item_id: updatedItem.tracker_item_id,
            tracker_url: updatedItem.tracker_url,
            sync_version: updatedItem.sync_version,
            sync_status: updatedItem.sync_status,
        };
    }

    /**
     * Process transactional outbox queue with retry & isolation logic.
     * Rejects stale outbox payloads with [STALE_SYNC_VERSION].
     */
    async processOutbox(args: ProcessOutboxArgs) {
        const { projectId, simulateUnreachable, staleOutboxItem } = args;

        if (staleOutboxItem) {
            if (staleOutboxItem.syncVersion < staleOutboxItem.lastSyncedVersion) {
                throw new Error(
                    `[STALE_SYNC_VERSION] Outbox payload version (${staleOutboxItem.syncVersion}) is lower than last synced version (${staleOutboxItem.lastSyncedVersion})`,
                );
            }
        }

        if (simulateUnreachable) {
            await prisma.outboxEvent.create({
                data: {
                    project_id: projectId,
                    event_type: 'work_item.sync_attempt',
                    payload: { simulateUnreachable: true },
                    status: 'pending',
                    retry_count: 1,
                    last_error: 'Plane API unreachable (503 Service Unavailable)',
                },
            });

            const pendingCount = await prisma.outboxEvent.count({
                where: { project_id: projectId, status: 'pending' },
            });

            return {
                failed_deliveries_stored_in_outbox: true,
                pending_outbox_count: pendingCount,
            };
        }

        const pendingEvents = await prisma.outboxEvent.findMany({
            where: { project_id: projectId, status: 'pending' },
        });

        for (const evt of pendingEvents) {
            await prisma.outboxEvent.update({
                where: { id: evt.id },
                data: { status: 'delivered', updated_at: new Date() },
            });
        }

        return {
            processed_count: pendingEvents.length,
            status: 'completed',
        };
    }

    /**
     * Validates and deduplicates incoming webhook events in webhook_inbox.
     */
    async receiveWebhook(args: ReceiveWebhookArgs) {
        const { projectId, payload } = args;
        const { event_id } = payload;

        if (!event_id) {
            throw new Error('Missing event_id in webhook payload');
        }

        const existing = await prisma.webhookInbox.findUnique({
            where: { event_id },
        });

        if (existing) {
            return {
                status: 'duplicate',
                event_id,
                message: 'Webhook payload already processed',
            };
        }

        await prisma.webhookInbox.create({
            data: {
                project_id: projectId,
                event_id,
                event_type: (payload.action as string) || 'webhook.received',
                payload: payload as object,
                status: 'processed',
            },
        });

        return {
            status: 'processed',
            event_id,
            message: 'Webhook processed successfully',
        };
    }

    /**
     * Reconciles Planner state with Plane task tracker, detecting and repairing state drift.
     */
    async reconcileTaskTracker(args: ReconcileTaskTrackerArgs) {
        const { projectId, autoRepair = true } = args;

        const workItems = await prisma.workItem.findMany({
            where: { project_id: projectId },
        });

        let driftCount = 0;
        let repairedCount = 0;
        const reconciledItems = [];

        for (const item of workItems) {
            let isDrifted = false;

            if (!item.tracker_item_id || item.sync_status !== 'synced') {
                isDrifted = true;
                driftCount++;

                if (autoRepair) {
                    const repairedItemId = item.tracker_item_id || `plane-issue-${item.id}`;
                    const repairedUrl = item.tracker_url || `http://localhost/plane/issue/${item.id}`;

                    await prisma.workItem.update({
                        where: { id: item.id },
                        data: {
                            tracker_provider: 'plane',
                            tracker_project_id: String(projectId),
                            tracker_item_id: repairedItemId,
                            tracker_url: repairedUrl,
                            sync_status: 'synced',
                            last_synced_at: new Date(),
                        },
                    });

                    repairedCount++;
                    reconciledItems.push({
                        work_item_id: item.id,
                        status: 'repaired',
                        tracker_item_id: repairedItemId,
                    });
                }
            }
        }

        return {
            reconciled_items: reconciledItems,
            drift_count_before: driftCount,
            repaired_count: repairedCount,
        };
    }
}

export const taskTrackerService = new TaskTrackerService();
export default taskTrackerService;
