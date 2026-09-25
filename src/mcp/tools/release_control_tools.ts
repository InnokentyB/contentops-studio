import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import ownerPublicationControlsService from '../../services/owner_publication_controls.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import { asToolResult } from './common';

/**
 * Registers release publication execution and connector verification tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerReleaseControlTools(server: McpServer): void {
    server.registerTool('ba_release_approved_telegram_task', {
        description: 'Project-owner audited release of one exact accepted Telegram feed task for a separate explicit send. Does not publish or enable scheduler discovery.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedVisualMode: z.string(), expectedVisualState: z.string(),
            expectedSelectedAssetId: z.number().int().positive().nullable(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseTelegramTask(args)));

    server.registerTool('ba_release_approved_dzen_task958', {
        description: 'Owner-only audited release of exact accepted Dzen feed task #958 rev1 for separate task-native delivery. Does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseDzenTask958(args)));

    server.registerTool('ba_release_approved_dzen_task962', {
        description: 'Owner-only audited release of exact accepted Dzen feed task #962 rev1 for separate task-native delivery. Does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseDzenTask962(args)));

    server.registerTool('ba_release_approved_threads_task953', {
        description: 'Owner-only audited release of exact accepted Threads feed task #953 rev4 for separate task-native API delivery. Does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(), expectedAcceptedRevision: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseThreadsTask953(args)));

    server.registerTool('ba_release_approved_threads_task959', {
        description: 'Owner-only audited release of exact accepted Threads replacement task #959 rev2. Does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(), expectedAcceptedRevision: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseThreadsTask959(args)));

    server.registerTool('ba_verify_dzen_task958_connector', {
        description: 'Owner-only read-only authenticated editor probe for exact released Dzen task #958; records a 15-minute task-scoped connection proof without enabling the channel globally or publishing.',
        inputSchema: {
            projectId: z.number().int().positive(), taskId: z.number().int().positive(),
            actorId: z.string(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await dzenTaskPublicationService.verifyConnector(args)));

    server.registerTool('ba_verify_dzen_task962_connector', {
        description: 'Owner-only read-only authenticated editor probe for exact released Dzen task #962; records a 15-minute task-scoped connection proof without enabling the channel globally or publishing.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.number().int().positive(),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await dzenTaskPublicationService.verifyConnector(args)));
}
