import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import ownerPublicationControlsService from '../../services/owner_publication_controls.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import linkedinTask995RecoveryService from '../../services/linkedin_task995_recovery.service';
import { claimLinkedInBrowserPublication, releaseLinkedInBrowserTaskWithPrisma } from '../../services/linkedin_browser_owner_release.service';
import { releaseDzenTaskWithPrisma } from '../../services/dzen_owner_release.service';
import { asToolResult } from './common';

/**
 * Registers release publication execution and connector verification tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerReleaseControlTools(server: McpServer): void {
    server.registerTool('ba_release_approved_dzen_task', {
        description: 'Project-owner audited release of one exact accepted Dzen package. Verifies manifest, revision, body, channel, visual decision, asset and schedule; never contacts Dzen or records a publication fact.',
        inputSchema: {
            projectId: z.number().int().positive(), taskId: z.number().int().positive(), actorId: z.string(),
            expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedVisualState: z.enum(['NO_VISUAL_NEEDED', 'APPROVED']),
            expectedPlacement: z.string().min(1),
            expectedVisualDecisionVersion: z.number().int().positive(),
            expectedSelectedAssetId: z.number().int().positive().nullable(),
            expectedAssetSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedPublishAt: z.string().datetime({ offset: true }),
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await releaseDzenTaskWithPrisma(args)));

    server.registerTool('ba_release_approved_linkedin_browser_task', {
        description: 'Project-owner audited release of one exact accepted LinkedIn revision to the browser-publisher queue. Verifies manifest, body, asset, schedule, channel and absence of prior delivery; never contacts LinkedIn or records a publication fact.',
        inputSchema: {
            projectId: z.number().int().positive(), taskId: z.number().int().positive(), actorId: z.string(),
            expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedSelectedAssetId: z.number().int().positive(),
            expectedAssetSha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await releaseLinkedInBrowserTaskWithPrisma(args)));

    server.registerTool('ba_claim_linkedin_browser_publication', {
        description: 'Publisher claim for an existing owner-released LinkedIn browser publication work item. Refuses all other work kinds, channels and unreleased tasks.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            workItemId: z.number().int().positive(), leaseSeconds: z.number().int().positive().optional(),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await claimLinkedInBrowserPublication(args)));

    server.registerTool('ba_release_approved_telegram_task', {
        description: 'Project-owner audited release of one exact accepted Telegram feed or personal-profile Story task for a separate explicit send. Does not publish or enable scheduler discovery.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedVisualMode: z.string(), expectedVisualState: z.string(),
            expectedPlacement: z.enum(['feed', 'story']).optional().default('feed'),
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

    server.registerTool('ba_release_approved_threads_task966', {
        description: 'Owner-only audited release of exact accepted Threads task #966 rev1 and immutable NO_VISUAL_NEEDED decision #142. Does not publish.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            taskId: z.number().int().positive(), expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(), expectedAcceptedRevision: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseThreadsTask966(args)));

    server.registerTool('ba_release_approved_threads_task1021', {
        description: 'Owner-only audited release of exact accepted Threads task #1021 rev1 and immutable NO_VISUAL_NEEDED decision #197. Does not publish.',
        inputSchema: {
            projectId: z.literal(10), actorId: z.string(), taskId: z.literal(1021),
            expectedChannelId: z.literal(138), expectedContentRevision: z.literal(1),
            expectedAcceptedRevision: z.literal(1),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.literal('f505415d56f83b199ae501ac825694cff849331bf29849b672ea89f732fa9e6b'),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseThreadsTask1021(args)));

    server.registerTool('ba_reschedule_owner_released_task969', {
        description: 'Owner-only audited near-now reschedule of exact owner-released Telegram task #969 rev1/asset88. Changes only schedule_at and refreshes its exact release proof; never publishes.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            newScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedSelectedAssetId: z.number().int().positive(),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.rescheduleOwnerReleasedTask969(args)));

    server.registerTool('ba_correct_owner_released_task_schedule', {
        description: 'Project-owner audited CAS correction for an unpublished owner-released Telegram task. Verifies the current manifest, revision, body, channel, visual and absence of provider attempts; supersedes the old release, changes only schedule_at/publish_at, and requires a fresh owner release. Never publishes.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.number().int().positive(),
            expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(), expectedAcceptedRevision: z.number().int().positive(),
            expectedSelectedAssetId: z.number().int().positive().nullable(),
            expectedVisualMode: z.string().min(1), expectedVisualState: z.string().min(1),
            expectedPlacement: z.enum(['feed', 'story']),
            expectedScheduleAt: z.string().datetime({ offset: true }), expectedPublishAt: z.string().datetime({ offset: true }),
            newScheduleAt: z.string().datetime({ offset: true }), newPublishAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            correctionReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.correctOwnerReleasedTaskSchedule(args)));

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

    server.registerTool('ba_verify_dzen_task992_connector', {
        description: 'Owner-only read-only authenticated editor probe for exact owner-released Dzen article #992 rev3. Records a short-lived task-scoped proof and never publishes.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(), taskId: z.literal(992),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await dzenTaskPublicationService.verifyConnector(args)));

    server.registerTool('ba_confirm_dzen_task992_absent_and_authorize_retry', {
        description: 'Owner-only audited recovery for the exact frozen Dzen #992 rev3 incident. Records confirmed absence and authorizes one stable task-native retry key; never publishes.',
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(992), actorId: z.string(),
            idempotencyKey: z.string().min(1), resendIdempotencyKey: z.string().min(1),
            evidenceReference: z.string().min(10)
        }
    }, async (args) => asToolResult(await dzenTaskPublicationService.confirmAbsentAndAuthorizeRetry(args)));

    server.registerTool('ba_register_linkedin_task995_unconfirmed_attempt', {
        description: 'Registers the already-observed LinkedIn #995 adapter call as one durable UNKNOWN attempt. Never sends or retries provider publication.',
        inputSchema: { projectId: z.literal(7), taskId: z.literal(995) }
    }, async () => asToolResult(await linkedinTask995RecoveryService.protectHistoricalAttempt()));

    server.registerTool('ba_reconcile_linkedin_task995_attempt', {
        description: 'Read-only reconciliation of the durable LinkedIn #995 UNKNOWN attempt. Records a fact only for one exact accepted-body provider match; never sends.',
        inputSchema: { projectId: z.literal(7), taskId: z.literal(995) }
    }, async () => asToolResult(await linkedinTask995RecoveryService.reconcile()));

    server.registerTool('ba_repair_linkedin_task995_browser_routing', {
        description: 'Owner-only metadata repair for the historical LinkedIn #995 incident. Makes personal LinkedIn browser-assisted, preserves UNKNOWN attempt history, and never sends or reconciles a provider publication.',
        inputSchema: {
            projectId: z.literal(7), taskId: z.literal(995), actorId: z.string(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await linkedinTask995RecoveryService.repairBrowserAssistedRouting(args)));
}
