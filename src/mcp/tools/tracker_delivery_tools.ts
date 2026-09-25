import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import taskTrackerService from '../../services/task_tracker.service';
import deliveryService from '../../services/delivery.service';
import { EXTERNAL_PUBLICATION_ANNOTATIONS, asToolResult } from './common';

/**
 * Registers tracker synchronization, delivery outbox execution, webhook handling, and delivery recovery tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerTrackerDeliveryTools(server: McpServer): void {
    server.registerTool('ba_sync_task_tracker', {
        description: 'Synchronize a WorkItem projection with external task tracker (Plane).',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            idempotencyKey: z.string().optional()
        }
    }, async (args) => {
        const result = await taskTrackerService.syncTaskTracker(args);
        return asToolResult(result);
    });

    server.registerTool('ba_process_outbox', {
        description: 'Process outbox events for task tracker sync and retry delivery.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            simulateUnreachable: z.boolean().optional(),
            staleOutboxItem: z.object({
                workItemId: z.number().int().positive(),
                syncVersion: z.number().int(),
                lastSyncedVersion: z.number().int()
            }).optional()
        }
    }, async (args) => {
        const result = await taskTrackerService.processOutbox(args);
        return asToolResult(result);
    });

    server.registerTool('ba_receive_webhook', {
        description: 'Process and deduplicate incoming webhook payloads from external task tracker.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            payload: z.object({
                event_id: z.string(),
                action: z.string().optional(),
                issue_id: z.string().optional(),
                state: z.string().optional()
            }).passthrough()
        }
    }, async (args) => {
        const result = await taskTrackerService.receiveWebhook(args);
        return asToolResult(result);
    });

    server.registerTool('ba_reconcile_task_tracker', {
        description: 'Reconcile Planner WorkItem states with external task tracker states.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            autoRepair: z.boolean().optional()
        }
    }, async (args) => {
        const result = await taskTrackerService.reconcileTaskTracker(args);
        return asToolResult(result);
    });

    server.registerTool('ba_execute_delivery', {
        description: 'Execute publication delivery attempt to a target channel.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            contentItemId: z.number().int().positive(),
            channelId: z.number().int().positive(),
            forceAutomatic: z.boolean().optional(),
            unapproved: z.boolean().optional(),
            simulateFailure: z.boolean().optional(),
            idempotencyKey: z.string().optional(),
            scheduledAt: z.string().optional()
        }
    }, async (args) => {
        const result = await deliveryService.executeDelivery(args);
        return asToolResult(result);
    });

    server.registerTool('ba_recover_delivery', {
        description: 'Legacy recovery entrypoint. Unsafe status-only recovery is disabled; retry the canonical publication task instead.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            deliveryAttemptId: z.number().int().positive()
        }
    }, async (args) => {
        const result = await deliveryService.recoverDelivery(args);
        return asToolResult(result);
    });

    server.registerTool('ba_invalidate_false_deliveries', {
        description: 'Owner-only audited correction for legacy delivery attempts that claimed success without a canonical provider permalink or object identity. Does not modify publication content or facts.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string().min(1),
            contentItemId: z.number().int().positive(),
            attemptIds: z.array(z.number().int().positive()).min(1),
            reason: z.string().min(1).max(1800),
            idempotencyKey: z.string().min(1).max(500)
        }
    }, async (args) => asToolResult(await deliveryService.invalidateFalseDeliveries(args)));
}
