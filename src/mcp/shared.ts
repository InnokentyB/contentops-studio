import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerVkSearchTools } from './tools/vk_search_tools';
import prisma, { pool } from '../db';
import workQueueService from '../services/work_queue.service';
import { repairTask1051ReviewCollision } from '../services/task1051_review_collision.service';
import { repairTask1091ReviewCollision } from '../services/task1091_review_collision.service';
import {
    adaptTask1091TdpdSource,
    TASK1091_PREVIOUS_BODY_SHA256,
    TASK1091_TDPD_ADAPTATION_KEY,
    TASK1091_TDPD_MANIFEST_CHECKSUM
} from '../services/task1091_tdpd_source_adaptation.service';
import { filterMcpServerTools, McpCapabilityProfile } from './capabilities';
import {
    asToolResult,
    asTelegramRouteToolError,
    requireWorkspaceIdentity,
    INTERNAL_MUTATION_ANNOTATIONS,
    EXTERNAL_PUBLICATION_ANNOTATIONS,
    registerIntelligenceTools,
    registerProjectPlanTools,
    registerParserTools,
    registerTaskPublicationTools,
    registerReleaseControlTools,
    registerWeeklyPipelineTools,
    registerWorkQueueTools,
    registerInitiativeTools,
    registerTrackerDeliveryTools,
    registerOwnerRepairTools,
    registerMediaMetricsTools
} from './tools';

export {
    asToolResult,
    asTelegramRouteToolError,
    requireWorkspaceIdentity,
    INTERNAL_MUTATION_ANNOTATIONS,
    EXTERNAL_PUBLICATION_ANNOTATIONS
};

/**
 * Creates and configures the ContentOps Planner MCP Server instance with tools filtered
 * according to the provided capability profile.
 *
 * @param options - Configuration options, including optional capability profile.
 * @returns Configured McpServer instance with role-appropriate tool capabilities.
 */
export function createPlannerMcpServer(options: { profile?: McpCapabilityProfile } = {}): McpServer {
    const profile = options.profile || 'owner';
    const server = new McpServer({
        name: 'contentops-studio-publication',
        version: '1.0.0'
    }, {
        instructions: profile === 'owner'
            ? 'ContentOps Planner MCP. Use project-scoped tools and preserve approval, readiness, and publication-fact gates.'
            : `You are connected as the project-scoped ${profile} role. First call ba_get_agent_workspace_manifest without inventing identity fields, then ba_get_agent_chat_bootstrap for your matching chat. Follow returned permissions and handoffs. Never request, reveal, or copy bearer tokens. Publisher must obey release-readiness and approval gates and must never infer delivery success without a confirmed provider result.`
    });

    registerPlannerTools(server);
    return filterMcpServerTools(server, profile);
}

/**
 * Registers all domain tool suites onto the provided McpServer.
 *
 * @param server - Target MCP server instance.
 */
export function registerPlannerTools(server: McpServer): void {
    // 1. Intelligence & Agent manifest tools
    registerIntelligenceTools(server);

    // 2. Project, User & Publication plan tools
    registerProjectPlanTools(server);

    // 3. Parser & Trend collection tools
    registerParserTools(server);

    // 4. Task publication, content edits, poll configuration & publication facts
    registerTaskPublicationTools(server);

    // 5. Release control and connector verification
    registerReleaseControlTools(server);

    // 6. Weekly theme pipeline & canvas
    registerWeeklyPipelineTools(server);

    // 7. Work queue lifecycle & review operations
    registerWorkQueueTools(server);

    // 8. Explicit contract test anchors: ba_recover_content_review
    server.registerTool('ba_recover_content_review', {
        description: 'Owner-only audited recovery: expose an existing publication content revision as a separately approvable review result without changing its body, channel, schedule, CTA or UTM data.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            taskId: z.number().int().positive(),
            workItemId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            idempotencyKey: z.string(),
            evidence: z.string().optional()
        }
    }, async (args) => {
        const result = await workQueueService.recoverContentReview(args);
        return asToolResult(result);
    });

    server.registerTool('ba_repair_task1051_review_collision', {
        description: 'Owner-authorized Editor repair for the exact task 1051 review-version collision. Preview or atomically supersede WI1731 and create one claimable revision-2 replacement; never changes copy, schedule, acceptance, art history, release state or publication state.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10),
            taskId: z.literal(1051),
            workItemId: z.literal(1731),
            actorId: z.string(),
            expectedContentRevision: z.literal(2),
            expectedAcceptedRevision: z.null(),
            expectedBodySha256: z.literal('d96eba545e5062bb339fef56c7e0ef7de39807c7892c7c46d461ef2c02b24d5e'),
            expectedScheduleAt: z.literal('2026-10-11T16:30:00.000Z'),
            expectedResultVersion: z.literal(2),
            expectedInputContextVersion: z.literal(2),
            idempotencyKey: z.literal('repair-p10-task1051-review-collision-20261011-v1'),
            reason: z.string().min(1),
            confirm: z.boolean()
        }
    }, async (args) => asToolResult(await repairTask1051ReviewCollision(args)));

    server.registerTool('ba_repair_task1091_review_collision', {
        description: 'Owner-authorized Editor repair for the exact task 1091 revision-2 review collision. Preview or atomically supersede WI1656 and create one claimable revision-2 replacement; never changes copy, schedule, acceptance, art history, release state or publication state.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10),
            taskId: z.literal(1091),
            workItemId: z.literal(1656),
            actorId: z.string(),
            expectedContentRevision: z.literal(2),
            expectedAcceptedRevision: z.null(),
            expectedBodySha256: z.literal('d4301764ab75882e461178972ce2958533e4d36d175e0bd94fccc3aaa91786c1'),
            expectedScheduleAt: z.literal('2026-10-13T17:30:00.000Z'),
            expectedResultVersion: z.literal(2),
            expectedInputContextVersion: z.literal(2),
            idempotencyKey: z.literal('repair-p10-task1091-review-collision-20261012-v1'),
            reason: z.string().min(1),
            confirm: z.boolean()
        }
    }, async (args) => asToolResult(await repairTask1091ReviewCollision(args)));

    server.registerTool('ba_adapt_task1091_tdpd_source', {
        description: 'Owner-authorized Planner adaptation of the existing task1091 slot to the Kun Chen / TDPD source package. Preserves accepted revision 2 as a historical candidate, reopens Writer and editorial gates, and never releases or publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10),
            taskId: z.literal(1091),
            initiativeId: z.literal(291),
            sourcePackageId: z.literal(311),
            previousSourcePackageId: z.literal(313),
            actorId: z.string(),
            expectedManifestChecksum: z.literal(TASK1091_TDPD_MANIFEST_CHECKSUM),
            expectedContentRevision: z.literal(2),
            expectedAcceptedRevision: z.literal(2),
            expectedBodySha256: z.literal(TASK1091_PREVIOUS_BODY_SHA256),
            expectedChannelId: z.literal(108),
            expectedScheduleAt: z.literal('2026-10-13T17:30:00.000Z'),
            expectedTitle: z.literal('Portfolio OS #2 — Я устал напоминать агентам, что мы вообще решили'),
            idempotencyKey: z.literal(TASK1091_TDPD_ADAPTATION_KEY),
            authorizationReference: z.string().min(1),
            confirm: z.boolean()
        }
    }, async (args) => asToolResult(await adaptTask1091TdpdSource(args)));

    // Explicit contract test anchors: ba_repair_publication_projection
    server.registerTool('ba_repair_publication_projection', {
        description: 'Owner-only audited metadata repair for an unpublished accepted publication: rebuild stored action, handoff and metrics routing fields from the current top-level channel and placement without changing content, schedule, revisions, visual decisions or assets.',
        inputSchema: {
            projectId: z.number().int().positive(),
            actorId: z.string(),
            taskId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedChannelId: z.number().int().positive(),
            expectedPlacement: z.string(),
            expectedSelectedAssetId: z.number().int().positive(),
            idempotencyKey: z.string()
        }
    }, async (args) => {
        const result = await workQueueService.repairPublicationProjection(args);
        return asToolResult(result);
    });

    // 9. Initiatives, operational calendar & blockers
    registerInitiativeTools(server);

    // 10. Tracker sync, delivery outbox & webhook reconciliation
    registerTrackerDeliveryTools(server);

    // 11. Owner repairs, CAS overrides & false deliveries
    registerOwnerRepairTools(server);

    // 12. Media assets, art direction, metrics & Dzen engagement
    registerMediaMetricsTools(server);
    registerVkSearchTools(server);
}

/**
 * Gracefully shuts down MCP database connection pools and Prisma clients.
 */
export async function shutdownMcpResources(): Promise<void> {
    try {
        await prisma.$disconnect();
    } catch (_error) {
        // Ignore shutdown errors.
    }

    try {
        await pool.end();
    } catch (_error) {
        // Ignore shutdown errors.
    }
}
