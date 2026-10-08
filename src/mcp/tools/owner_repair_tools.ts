import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import ownerPublicationControlsService from '../../services/owner_publication_controls.service';
import publishedChannelRepairService from '../../services/published_channel_repair.service';
import workQueueService from '../../services/work_queue.service';
import threadsCredentialAllocationService from '../../services/threads_credential_allocation.service';
import { asToolResult } from './common';
import publicationRetirementService from '../../services/publication_retirement.service';

/**
 * Registers owner-level repair, visual overrides, and false delivery invalidation tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerOwnerRepairTools(server: McpServer): void {
    const retirementGuards = {
        projectId: z.union([z.literal(7), z.literal(10)]),
        projectSlug: z.enum(['seturon', 'analystcraft-2']),
        actorId: z.string().regex(/^user:\d+$/),
        expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        expectedTasks: z.array(z.object({
            taskId: z.number().int().positive(),
            expectedStatus: z.string().trim().min(1),
            expectedPublicationMode: z.string().trim().min(1)
        })).min(5).max(32),
        approvalReference: z.string().trim().min(10).max(1000)
    };

    server.registerTool('ba_preview_publication_retirement', {
        description: 'Owner-only read-only preview for the exact approved legacy publication-retirement batches in projects 7 and 10. Checks project slug, current manifest checksum, exact task IDs/states and absence of facts. Project 10 also performs an exact-text read-only MTProto history check for Telegram task 1011. Never sends or writes.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        inputSchema: retirementGuards
    }, async args => asToolResult(await publicationRetirementService.preview(args)));

    server.registerTool('ba_apply_publication_retirement', {
        description: 'Owner-only audited atomic apply of an exact retirement preview. Changes only task status to cancelled and publication_mode to retired; preserves attempts, assets, copy, uncertainty, work items and facts. If exact task-1011 MTProto history proves publication, reconciles that fact instead. If its session is unavailable, creates one non-resend reconciliation blocker.',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            ...retirementGuards,
            previewHash: z.string().regex(/^[a-f0-9]{64}$/),
            reason: z.string().trim().min(20).max(2000),
            idempotencyKey: z.string().trim().min(1).max(500)
        }
    }, async args => asToolResult(await publicationRetirementService.apply(args)));

    const uncertaintyProjectionGuards = {
        projectId: z.literal(10), projectSlug: z.literal('analystcraft-2'), actorId: z.string().regex(/^user:\d+$/),
        expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/), expectedRetirementAuditId: z.number().int().positive(),
        approvalReference: z.string().trim().min(10).max(1000)
    };
    server.registerTool('ba_preview_retirement_uncertainty_projection', {
        description: 'Owner-only read-only preview that preserves provider_result_uncertain explicitly for retired tasks 854, 984 and 1011 after the exact audited batch retirement. No other task or field is in scope.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: uncertaintyProjectionGuards
    }, async args => asToolResult(await publicationRetirementService.previewUncertaintyProjection(args)));
    server.registerTool('ba_apply_retirement_uncertainty_projection', {
        description: 'Owner-only audited exact projection of provider_result_uncertain=true for retired tasks 854, 984 and 1011. Preserves status, modes, copy, assets, facts, attempts and work items; never publishes.',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: { ...uncertaintyProjectionGuards, previewHash: z.string().regex(/^[a-f0-9]{64}$/),
            reason: z.string().trim().min(20).max(2000), idempotencyKey: z.string().trim().min(1).max(500) }
    }, async args => asToolResult(await publicationRetirementService.applyUncertaintyProjection(args)));

    server.registerTool('ba_encrypt_legacy_threads_source_credential', {
        description: 'Owner-only audited in-place encryption of the exact legacy Threads token in project 32/channel 176. Uses CAS and idempotency, never returns the token and never publishes.',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: {
            actorId: z.string().regex(/^user:\d+$/),
            projectId: z.literal(32),
            channelId: z.literal(176),
            expectedUpdatedAt: z.string().datetime({ offset: true }),
            idempotencyKey: z.string().trim().min(1).max(500)
        }
    }, async args => asToolResult({ ...await threadsCredentialAllocationService.migrateLegacySource(args) }));

    server.registerTool('ba_allocate_threads_channel_credential', {
        description: 'Owner-only audited server-side allocation of the verified encrypted Threads identity from project 32/channel 176 to project 10/channel 138. Requires ownership of both projects, exact channel versions and idempotency; never returns the token or publishes.',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        inputSchema: {
            actorId: z.string().regex(/^user:\d+$/),
            sourceProjectId: z.literal(32),
            sourceChannelId: z.literal(176),
            targetProjectId: z.literal(10),
            targetChannelId: z.literal(138),
            expectedSourceUpdatedAt: z.string().datetime({ offset: true }),
            expectedTargetUpdatedAt: z.string().datetime({ offset: true }),
            idempotencyKey: z.string().trim().min(1).max(500)
        }
    }, async args => asToolResult({ ...await threadsCredentialAllocationService.allocate(args) }));

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
