import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import prisma, { pool } from '../db';
import workQueueService from '../services/work_queue.service';
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
