import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import workQueueService from '../../services/work_queue.service';
import { INTERNAL_MUTATION_ANNOTATIONS, asToolResult } from './common';

/**
 * Registers work queue lifecycle, review submission, and exception handling tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerWorkQueueTools(server: McpServer): void {
    server.registerTool('ba_get_work_item', {
        description: 'Get details of a specific work item including latest approval decision.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive()
        }
    }, async (args) => {
        const result = await workQueueService.getWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_get_work_item_context', {
        description: 'Get full execution context for a work item including week frame, thesis, and resolved source resources.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            maxChars: z.number().int().positive().optional()
        }
    }, async (args) => {
        const result = await workQueueService.getWorkItemContext(args);
        return asToolResult(result);
    });

    server.registerTool('ba_claim_work_item', {
        description: 'Atomically claim a work item for execution with a timed lease token.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseSeconds: z.number().int().positive().optional(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.claimWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_complete_work_item', {
        description: 'Complete execution of a work item and submit the result payload, unlocking content review.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseToken: z.string(),
            result: z.object({
                body: z.string().optional(),
                text: z.string().optional(),
                format: z.string().optional()
            }).passthrough(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.completeWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_claim_content_review', {
        description: 'Claim an available content_reviewer work item with a 30-minute reviewer-owned lease. A new idempotency key atomically recovers an expired reviewer lease and records that recovery in the workflow audit trail.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            expectedResultVersion: z.number().int().nonnegative(),
            expectedContentRevision: z.number().int().positive(),
            idempotencyKey: z.string()
        }
    }, async (args) => asToolResult(await workQueueService.claimContentReview(args)));

    server.registerTool('ba_submit_content_review', {
        description: 'Submit a lease-bound content review for editor approval without changing copy or accepting the revision.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            expectedResultVersion: z.number().int().nonnegative(),
            expectedContentRevision: z.number().int().positive(),
            leaseToken: z.string(),
            result: z.object({
                recommendation: z.enum(['approve', 'revise']),
                summary: z.string().min(1),
                findings: z.array(z.string()).optional()
            }),
            idempotencyKey: z.string()
        }
    }, async (args) => asToolResult(await workQueueService.submitContentReview(args)));

    server.registerTool('ba_decide_approval', {
        description: 'Approve or reject a content review work item result version.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            resultVersion: z.number().int(),
            decision: z.enum(['approved', 'rejected']),
            comment: z.string().optional(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.decideApproval(args);
        return asToolResult(result);
    });

    server.registerTool('ba_recover_missing_content_review', {
        description: 'Owner-only audited recovery: create a missing content-review gate for an existing unaccepted revision without changing publication content, slot fields or accepting the revision.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            taskId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            idempotencyKey: z.string(),
            evidenceRequirement: z.string().optional()
        }
    }, async (args) => {
        const result = await workQueueService.recoverMissingContentReview(args);
        return asToolResult(result);
    });

    server.registerTool('ba_repair_publication_placement', {
        description: 'Owner-only audited metadata repair for an unpublished accepted publication: atomically change only channel and canonical visual placement and create a new revision-bound art-direction work item. The target placement must match the configured channel contract.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            taskId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedChannelId: z.number().int().positive().nullable(),
            expectedPlacement: z.string(),
            targetChannelId: z.number().int().positive(),
            targetPlacement: z.string(),
            blockedWorkItemId: z.number().int().positive(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.repairPublicationPlacement(args);
        return asToolResult(result);
    });

    server.registerTool('ba_list_schedule_exceptions', {
        description: 'List schedule exceptions (overdue content, missed publication slots, unavailable sources).',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            asOf: z.string().optional(),
            includeBlocked: z.boolean().optional()
        }
    }, async (args) => {
        const result = await workQueueService.listScheduleExceptions(args);
        return asToolResult(result);
    });

    server.registerTool('ba_block_work_item', {
        description: 'Manually block a work item with an explicit reason code.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseToken: z.string(),
            reasonCode: z.string(),
            note: z.string().optional(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.blockWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_release_work_item', {
        description: 'Release a claimed work item lease back to the available queue.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            leaseToken: z.string(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.releaseWorkItem(args);
        return asToolResult(result);
    });

    server.registerTool('ba_reschedule_work_item', {
        description: 'Reschedule a work item due date with an explicit audit reason.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            workItemId: z.number().int().positive(),
            dueAt: z.string(),
            reason: z.string(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.rescheduleWorkItem(args);
        return asToolResult(result);
    });
}
