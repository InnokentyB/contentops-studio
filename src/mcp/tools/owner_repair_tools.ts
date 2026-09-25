import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import ownerPublicationControlsService from '../../services/owner_publication_controls.service';
import publishedChannelRepairService from '../../services/published_channel_repair.service';
import workQueueService from '../../services/work_queue.service';
import { asToolResult } from './common';

/**
 * Registers owner-level repair, visual overrides, and false delivery invalidation tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerOwnerRepairTools(server: McpServer): void {
    server.registerTool('ba_require_publication_visual', {
        description: 'Owner-only audited CAS for one exact accepted unpublished task: require a visual and create its first revision-bound art-direction work item. Preserves channel binding (including null), copy, schedule, acceptance and publication state; never attaches or publishes.',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(), expectedAcceptedRevision: z.number().int().positive(),
            expectedChannelId: z.number().int().positive().nullable(), expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedVisualMode: z.string(), expectedVisualState: z.string(), expectedVisualPlacement: z.string(),
            expectedStatus: z.string(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await workQueueService.requirePublicationVisual(args)));

    server.registerTool('ba_require_c20_publication_visuals', {
        description: 'Project-owner atomic repair of visual_mode=required for exactly six unpublished C20 channel-111 tasks. No content, art decision, schedule or publication change.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            expected: z.array(z.object({
                taskId: z.number().int().positive(),
                expectedContentRevision: z.number().int().nonnegative(),
                expectedAcceptedRevision: z.number().int().nonnegative().nullable(),
                expectedStatus: z.string(), expectedVisualState: z.string(),
                expectedScheduleAt: z.string().datetime({ offset: true })
            })).length(6),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.requireC20Visuals(args)));

    server.registerTool('ba_require_task971_publication_visual', {
        description: 'Owner-only audited CAS: set only task #971 visual_mode=required for accepted revision 3 and approved feed asset #76. Does not release or publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedSelectedAssetId: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedStatus: z.string(), expectedVisualState: z.string(),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.requireTask971Visual(args)));

    server.registerTool('ba_require_task972_publication_visual', {
        description: 'Owner-only audited CAS for exact task #972 rev1: change only visual_mode from auto_assess to required while preserving approved decision #152 and asset #77. Does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(), expectedAcceptedRevision: z.number().int().positive(),
            expectedSelectedAssetId: z.number().int().positive(), expectedDecisionId: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedStatus: z.string(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.requireTask972Visual(args)));

    server.registerTool('ba_require_task973_publication_visual', {
        description: 'Owner-only audited CAS for exact task #973 rev1: change only visual_mode from auto_assess to required while preserving approved decision #155 and asset #80. Does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(), expectedAcceptedRevision: z.number().int().positive(),
            expectedSelectedAssetId: z.number().int().positive(), expectedDecisionId: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedStatus: z.string(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.requireTask973Visual(args)));

    server.registerTool('ba_repair_task972_publication_metadata', {
        description: 'Owner-only audited CAS for exact task #972 rev1: replace only stale title and brief after visual_mode is required. Preserves body, art, asset, schedule, handoff and publication mode; does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.number().int().positive(),
            expectedChannelId: z.number().int().positive(), expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(), expectedSelectedAssetId: z.number().int().positive(),
            expectedDecisionId: z.number().int().positive(), expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/), expectedStatus: z.string(),
            expectedTitle: z.string(), expectedBrief: z.string(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.repairTask972Metadata(args)));

    server.registerTool('ba_bind_task960_linkedin_identity', {
        description: 'Owner-only task-scoped CAS for #960: bind the handoff to Innokenty Bodrov personal LinkedIn profile without renaming shared channel 123 or publishing.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.number().int().positive(),
            expectedChannelId: z.number().int().positive(), expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(), expectedDecisionId: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/), expectedStatus: z.string(),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.bindTask960LinkedinIdentity(args)));

    server.registerTool('ba_create_task970_t72_checkpoint', {
        description: 'Owner-only idempotent creation of the exact manual t72h metric checkpoint for published task #970/fact #345. Preserves t24h/t7d and publication state.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.number().int().positive(),
            expectedChannelId: z.number().int().positive(), expectedFactId: z.number().int().positive(),
            scheduledFor: z.string().datetime({ offset: true }), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.createTask970T72Checkpoint(args)));

    const publishedChannelRepairGuards = {
        projectId: z.number().int().positive(),
        actorId: z.string(),
        taskId: z.number().int().positive(),
        expectedCurrentChannelId: z.number().int().positive(),
        targetChannelId: z.number().int().positive(),
        expectedPublicationFactId: z.number().int().positive(),
        expectedPublicUrl: z.string().url(),
        expectedSnapshots: z.array(z.object({
            id: z.number().int().positive(),
            channelId: z.number().int().positive()
        })).min(1).max(20)
    };

    server.registerTool('ba_preview_published_channel_repair', {
        description: 'Owner-only read-only preview for an exact published-task channel repair. Returns a hash-bound bounded diff and never publishes, collects metrics, or writes data.',
        annotations: { readOnlyHint: true },
        inputSchema: publishedChannelRepairGuards
    }, async (args) => asToolResult(await publishedChannelRepairService.preview(args)));

    server.registerTool('ba_apply_published_channel_repair', {
        description: 'Owner-only audited repair of one published task channel binding, its existing publication fact, metric snapshots and derived routing projections. Requires the exact preview hash and guards; never publishes or collects metrics.',
        inputSchema: {
            ...publishedChannelRepairGuards,
            previewHash: z.string().regex(/^[a-f0-9]{64}$/),
            reason: z.string().trim().min(1).max(1000),
            idempotencyKey: z.string().trim().min(1).max(500)
        }
    }, async (args) => asToolResult(await publishedChannelRepairService.apply(args)));
}
