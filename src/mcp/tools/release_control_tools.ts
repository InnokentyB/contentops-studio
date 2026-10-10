import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLinkedInTask1076ReleaseTool } from './linkedin_task1076_release_tool';
import { registerLinkedInTask1090ReleaseTool } from './linkedin_task1090_release_tool';
import { registerOct08ExactReleaseTools } from './oct08_exact_release_tools';
import { registerThreadsTask1035ReleaseTool } from './threads_task1035_release_tool';
import { registerXTask1033ReleaseTool } from './x_task1033_release_tool';
import { registerOct10OwnerRecoveryTools } from './oct10_owner_recovery_tools';
import { registerVkTask1084HoldTool } from './vk_task1084_hold_tool';
import { registerVkTask1084RestoreTool } from './vk_task1084_restore_tool';
import { z } from 'zod';
import ownerPublicationControlsService from '../../services/owner_publication_controls.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import linkedinTask995RecoveryService from '../../services/linkedin_task995_recovery.service';
import { claimLinkedInBrowserPublication, releaseLinkedInBrowserTaskWithPrisma } from '../../services/linkedin_browser_owner_release.service';
import { releaseDzenTaskWithPrisma } from '../../services/dzen_owner_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';
import { releaseLinkedInTask1075 } from '../../services/linkedin_task1075_release.service';
import { claimXBrowserPublication, releaseXTask1025 } from '../../services/x_task1025_release.service';
import { releaseXTask1079 } from '../../services/x_task1079_release.service';
import { releaseXTask1025Revision3 } from '../../services/x_task1025_rev3_release.service';
import { releasePendingThreadsTask } from '../../services/threads_pending_release.service';
import { resumeDzenTask999 } from '../../services/dzen_task999_resume.service';
import { claimVkBrowserPublication, releaseVkBrowserTaskWithPrisma } from '../../services/vk_browser_owner_release.service';
import {
    confirmVkBrowserSubmissionWithPrisma,
    markVkBrowserSubmissionUncertainWithPrisma,
    startVkBrowserSubmissionWithPrisma
} from '../../services/vk_browser_submission_control.service';
import {
    applyVkBrowserPreProviderRecoveryWithPrisma,
    previewVkBrowserPreProviderRecoveryWithPrisma
} from '../../services/vk_browser_pre_provider_recovery.service';
import {
    applyVkBrowserPreSubmitRecoveryWithPrisma,
    previewVkBrowserPreSubmitRecoveryWithPrisma
} from '../../services/vk_browser_pre_submit_recovery.service';
import {
    claimSetkaTask1047,
    confirmSetkaTask1047,
    markSetkaTask1047Uncertain,
    releaseSetkaTask1047,
    SETKA1047,
    startSetkaTask1047
} from '../../services/setka_task1047_recovery.service';

/**
 * Registers release publication execution and connector verification tools.
 *
 * @param server - Target MCP server instance.
 */
export function registerReleaseControlTools(server: McpServer): void {
    registerLinkedInTask1076ReleaseTool(server);
    registerLinkedInTask1090ReleaseTool(server);
    registerOct08ExactReleaseTools(server);
    registerThreadsTask1035ReleaseTool(server);
    registerXTask1033ReleaseTool(server);
    registerOct10OwnerRecoveryTools(server);
    registerVkTask1084HoldTool(server);
    registerVkTask1084RestoreTool(server);
    server.registerTool('ba_resume_dzen_task999_existing_draft', {
        description: 'Owner-authorized exact existing Dzen999 draft recovery. Defaults to read-only package/cover/final-stage preview; confirm true performs one original-key CAS-bound final submit, never opens a new composer.',
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(999), actorId: z.string(),
            idempotencyKey: z.literal('dzen-999-owner-approved-live-20261006-v1'),
            confirm: z.boolean().optional().default(false)
        }
    }, async args => asToolResult(await resumeDzenTask999(args)));
    server.registerTool('ba_release_approved_vk_browser_task', {
        description: 'Project-owner audited release of one exact accepted VK feed, article, video or Story revision to the local browser-publisher queue. It never opens VK, uploads media, publishes, or records a publication fact.',
        inputSchema: {
            projectId: z.number().int().positive(), taskId: z.number().int().positive(), actorId: z.string(),
            expectedChannelId: z.number().int().positive(),
            expectedContentRevision: z.number().int().positive(),
            expectedAcceptedRevision: z.number().int().positive(),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedTitleSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
            expectedSelectedAssetId: z.number().int().positive(),
            expectedAssetSha256: z.string().regex(/^[a-f0-9]{64}$/),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedPlacement: z.enum(['feed', 'article_cover', 'video_cover', 'story']).optional().default('feed'),
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await releaseVkBrowserTaskWithPrisma(args)));

    server.registerTool('ba_claim_vk_browser_publication', {
        description: 'Publisher claim for one owner-released VK browser work item. Returns a short-lived lease; it does not contact VK.',
        inputSchema: {
            projectId: z.number().int().positive(), actorId: z.string(),
            workItemId: z.number().int().positive(), leaseSeconds: z.number().int().positive().optional(),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await claimVkBrowserPublication(args)));

    server.registerTool('ba_start_vk_browser_submission', {
        description: 'Durably starts one claimed VK browser delivery attempt immediately before any provider-side upload or submit. Existing attempts block retry.',
        inputSchema: {
            projectId: z.number().int().positive(), taskId: z.number().int().positive(),
            channelId: z.number().int().positive(), actorId: z.string(),
            workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
            contentRevision: z.number().int().positive(),
            textSha256: z.string().regex(/^[a-f0-9]{64}$/),
            titleSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
            imageSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
            selectedAssetId: z.number().int().positive().nullable(),
            placement: z.enum(['feed', 'article_cover', 'video_cover', 'story']).optional().default('feed')
        }
    }, async (args) => asToolResult(await startVkBrowserSubmissionWithPrisma(args)));

    server.registerTool('ba_confirm_vk_browser_submission', {
        description: 'Confirms a started VK browser attempt only from an exact provider permalink/object readback, then records the canonical publication fact.',
        inputSchema: {
            projectId: z.number().int().positive(), taskId: z.number().int().positive(),
            channelId: z.number().int().positive(), actorId: z.string(),
            workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
            contentRevision: z.number().int().positive(),
            textSha256: z.string().regex(/^[a-f0-9]{64}$/),
            titleSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
            imageSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
            selectedAssetId: z.number().int().positive().nullable(),
            placement: z.enum(['feed', 'article_cover', 'video_cover', 'story']).optional().default('feed'),
            attemptId: z.number().int().positive(), publicUrl: z.string().url().nullable(),
            providerObjectId: z.string().regex(/^(?:-\d+_\d+|(?:video|article|story)-\d+_\d+)$/),
            publishedAt: z.string().datetime({ offset: true }),
            evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/)
        }
    }, async (args) => asToolResult(await confirmVkBrowserSubmissionWithPrisma(args)));

    server.registerTool('ba_mark_vk_browser_submission_uncertain', {
        description: 'Freezes a started VK browser attempt when submit or readback is ambiguous. It records no publication fact and never authorizes retry.',
        inputSchema: {
            projectId: z.number().int().positive(), taskId: z.number().int().positive(), actorId: z.string(),
            workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
            attemptId: z.number().int().positive(), reasonCode: z.string().min(1),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await markVkBrowserSubmissionUncertainWithPrisma(args)));

    const setkaBoundary = {
        projectId: z.literal(10), taskId: z.literal(1047), channelId: z.literal(126), actorId: z.string(),
        workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
        approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
        contentRevision: z.literal(4), textSha256: z.literal(SETKA1047.bodySha256),
        selectedAssetId: z.literal(131), imageSha256: z.literal(SETKA1047.assetSha256)
    };
    server.registerTool('ba_release_setka_task1047_browser', {
        description: 'Owner-only audited release for exact Setka task1047. Atomically binds the confirmed owned profile, reconciles manual/browser capability and creates one browser work item. Never opens Setka or publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1047), actorId: z.string(),
            expectedChannelId: z.literal(126), expectedContentRevision: z.literal(4),
            expectedAcceptedRevision: z.literal(4), expectedBodySha256: z.literal(SETKA1047.bodySha256),
            expectedDecisionId: z.literal(269), expectedSelectedAssetId: z.literal(131),
            expectedAssetSha256: z.literal(SETKA1047.assetSha256),
            expectedScheduleAt: z.literal(SETKA1047.schedule), expectedManifestChecksum: z.literal(SETKA1047.manifest),
            expectedRegistryProfileId: z.literal('profile_126'), expectedProfileUrl: z.literal(SETKA1047.profileUrl),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await releaseSetkaTask1047(args)));
    server.registerTool('ba_claim_setka_task1047_browser_publication', {
        description: 'Publisher claim for the exact owner-released Setka1047 browser work item. Never opens Setka.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), actorId: z.string(), workItemId: z.number().int().positive(),
            leaseSeconds: z.number().int().positive().optional(), idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await claimSetkaTask1047(args)));
    server.registerTool('ba_start_setka_task1047_browser_submission', {
        description: 'Durably starts the exact claimed Setka1047 attempt immediately before browser/manual submission. Retry is forbidden after an attempt exists.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: setkaBoundary
    }, async args => asToolResult(await startSetkaTask1047(args)));
    server.registerTool('ba_confirm_setka_task1047_browser_submission', {
        description: 'Confirms Setka1047 only from an exact setka.ru/posts permalink plus screenshot evidence, then records the publication fact.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...setkaBoundary, attemptId: z.number().int().positive(),
            publicUrl: z.string().url(), providerObjectId: z.string().regex(/^[0-9a-f-]+$/),
            publishedAt: z.string().datetime({ offset: true }), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }
    }, async args => asToolResult(await confirmSetkaTask1047(args)));
    server.registerTool('ba_mark_setka_task1047_browser_submission_uncertain', {
        description: 'Freezes an ambiguous Setka1047 attempt for verification. Creates no fact and never authorizes retry.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1047), actorId: z.string(),
            workItemId: z.number().int().positive(), leaseToken: z.string().min(1),
            attemptId: z.number().int().positive(), reasonCode: z.string().min(1), idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await markSetkaTask1047Uncertain(args)));

    const vkPreProviderRecoveryGuards = {
        projectId: z.number().int().positive(), taskId: z.number().int().positive(), actorId: z.string(),
        expectedChannelId: z.number().int().positive(),
        expectedContentRevision: z.number().int().positive(),
        expectedAcceptedRevision: z.number().int().positive(),
        expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
        expectedSelectedAssetId: z.number().int().positive(),
        expectedAssetSha256: z.string().regex(/^[a-f0-9]{64}$/),
        expectedWorkItemId: z.number().int().positive(),
        expectedFailureCode: z.string().min(1)
    };
    server.registerTool('ba_preview_vk_browser_pre_provider_recovery', {
        description: 'Owner-only read-only preview for rearming one VK browser attempt proven to have stopped before provider upload. Returns an exact hash-bound diff and never contacts VK.',
        inputSchema: vkPreProviderRecoveryGuards
    }, async (args) => asToolResult(await previewVkBrowserPreProviderRecoveryWithPrisma(args)));

    server.registerTool('ba_apply_vk_browser_pre_provider_recovery', {
        description: 'Owner-only audited apply for an exact previewed VK pre-provider abort. It preserves content and facts, closes the failed attempt, and returns the same work item to available without contacting VK.',
        inputSchema: {
            ...vkPreProviderRecoveryGuards,
            expectedAttemptId: z.number().int().positive(),
            previewToken: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            reason: z.string().min(20),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await applyVkBrowserPreProviderRecoveryWithPrisma(args)));

    const vkPreSubmitRecoveryGuards = {
        ...vkPreProviderRecoveryGuards,
        expectedFailureCode: z.literal('[VK_BROWSER_READBACK_UNCONFIRMED]'),
        evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        absenceObservedAt: z.string().datetime({ offset: true }),
        expectedLatestProviderObjectId: z.string().regex(/^-\d+_\d+$/)
    };
    server.registerTool('ba_preview_vk_browser_pre_submit_recovery', {
        description: 'Owner-only read-only preview for the exact VK task 1019 incident where the approved image uploaded but the final submit control was not invoked. Requires screenshot evidence and a recent exact public-absence observation; never contacts VK.',
        inputSchema: vkPreSubmitRecoveryGuards
    }, async (args) => asToolResult(await previewVkBrowserPreSubmitRecoveryWithPrisma(args)));
    server.registerTool('ba_apply_vk_browser_pre_submit_recovery', {
        description: 'Owner-only audited apply for an exact previewed VK pre-submit abort. Preserves content and facts, records provider upload without final submit, and rearms the same work item without contacting VK.',
        inputSchema: {
            ...vkPreSubmitRecoveryGuards,
            expectedAttemptId: z.number().int().positive(),
            previewToken: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            reason: z.string().min(20),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await applyVkBrowserPreSubmitRecoveryWithPrisma(args)));

    server.registerTool('ba_release_x_task1025_browser', {
        description: 'Owner-only exact audited release for project 10 Personal X task 1025. Creates one browser publication work item and never publishes.',
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1025), actorId: z.string(),
            expectedChannelId: z.literal(164), expectedContentRevision: z.literal(1),
            expectedAcceptedRevision: z.literal(1),
            expectedBodySha256: z.literal('2e0af78370143fbc4604726a70c3ebc70f63167f608da5413b5029181afe785c'),
            expectedDecisionId: z.literal(230), expectedReviewWorkItemId: z.literal(1475),
            expectedArtWorkItemId: z.literal(1477), expectedScheduleAt: z.literal('2026-10-05T15:00:00.000Z'),
            expectedManifestChecksum: z.literal('sha256:5500db954642b50ac4077ce9ef6ae8bd78f9382cc87d7911b0baacdaf95860d3'),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await releaseXTask1025(args)));

    server.registerTool('ba_release_x_task1079_browser', {
        description: 'Owner-only audited release of accepted revision 1 of Personal X task 1079, project 10/channel 164. Creates one browser work item after checking history; does not send.',
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1079), actorId: z.string(),
            expectedChannelId: z.literal(164), expectedContentRevision: z.literal(1),
            expectedAcceptedRevision: z.literal(1),
            expectedBodySha256: z.literal('286f4cba8795f2a64e439dff096866bf4dfa17a864a3e50788d9d95bfd8b3217'),
            expectedDecisionId: z.literal(228), expectedReviewWorkItemId: z.literal(1465),
            expectedArtWorkItemId: z.literal(1466), expectedScheduleAt: z.literal('2026-10-04T17:30:00.000Z'),
            expectedManifestChecksum: z.literal('sha256:dc5831717f09ee68f339ccb5b9e63ca00ce4b68edae810b80308fd09e11bcc71'),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await releaseXTask1079(args)));

    server.registerTool('ba_release_pending_threads_task', {
        description: 'Owner-only audited release of the fixed accepted rev1 packages for Threads tasks 1021 and 1026. Verifies provider identity and history guards; does not publish.',
        inputSchema: {
            projectId: z.literal(10), taskId: z.union([z.literal(1021), z.literal(1026)]),
            actorId: z.string(), approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async args => asToolResult(await releasePendingThreadsTask(args)));

    server.registerTool('ba_release_x_task1025_revision3_browser', {
        description: 'Owner-only audited release of accepted X task 1025 revision 3; cancels only the expired revision 1 browser lease and creates one revision 3 item, without sending.',
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1025), actorId: z.string(),
            expectedChannelId: z.literal(164), expectedContentRevision: z.literal(3), expectedAcceptedRevision: z.literal(3),
            expectedBodySha256: z.literal('c95ceb3e4e5218abe1df74b496ee6b8e54550d0123663c84f3062d33ea396c6b'),
            expectedDecisionId: z.literal(240), expectedReviewWorkItemId: z.literal(1475), expectedArtWorkItemId: z.literal(1535),
            expectedScheduleAt: z.literal('2026-10-05T15:00:00.000Z'),
            expectedManifestChecksum: z.literal('sha256:dc5831717f09ee68f339ccb5b9e63ca00ce4b68edae810b80308fd09e11bcc71'),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async args => asToolResult(await releaseXTask1025Revision3(args)));

    server.registerTool('ba_claim_x_browser_publication', {
        description: 'Publisher claim for owner-released Personal X tasks 1025 or 1079 on project 10/channel 164.',
        inputSchema: {
            projectId: z.literal(10), actorId: z.string(), workItemId: z.number().int().positive(),
            leaseSeconds: z.number().int().positive().optional(), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await claimXBrowserPublication(args)));
    server.registerTool('ba_release_linkedin_task1075_browser', {
        description: 'Owner-only exact audited release for project 7 LinkedIn task 1075. Reconciles stale upstream work item 1408 and atomically creates one browser publication work item; never publishes.',
        inputSchema: {
            projectId: z.literal(7), taskId: z.literal(1075), actorId: z.string(),
            expectedChannelId: z.literal(5), expectedContentRevision: z.literal(1),
            expectedAcceptedRevision: z.literal(1),
            expectedBodySha256: z.literal('24ce0bc8c6863662a8af115bef9a200dc3d75ca5b051b9d3ba6a04fc7109fb4f'),
            expectedDecisionId: z.literal(234), expectedScheduleAt: z.literal('2026-10-05T09:00:00.000Z'),
            staleUpstreamWorkItemId: z.literal(1408), expectedEditorWorkItemId: z.literal(1483),
            expectedArtWorkItemId: z.literal(1484), approvalReference: z.string().min(10),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await releaseLinkedInTask1075(args)));
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

    server.registerTool('ba_release_approved_threads_task1029', {
        description: 'Owner-only audited release of exact accepted Threads task #1029 rev3 and immutable NO_VISUAL_NEEDED decision #212. Does not publish.',
        inputSchema: {
            projectId: z.literal(10), actorId: z.string(), taskId: z.literal(1029), expectedChannelId: z.literal(138),
            expectedContentRevision: z.literal(3), expectedAcceptedRevision: z.literal(3),
            expectedScheduleAt: z.string().datetime({ offset: true }),
            expectedBodySha256: z.literal('f59a4e27a001c2b6fd297683d626c1f2479125d184896036d91c2e3edae6666e'),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await ownerPublicationControlsService.releaseThreadsTask1029(args)));

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

    server.registerTool('ba_verify_dzen_task1031_connector', {
        description: 'Owner-only read-only authenticated editor probe for exact owner-released Dzen article #1031 rev3. Records a short-lived task-scoped proof and never publishes.',
        inputSchema: {
            projectId: z.literal(10), actorId: z.string(), taskId: z.literal(1031),
            idempotencyKey: z.string().min(1)
        }
    }, async (args) => asToolResult(await dzenTaskPublicationService.verifyConnector(args)));

    server.registerTool('ba_verify_dzen_task999_connector', {
        description: 'Owner-only authenticated editor probe for released Dzen article #999 revision 2 and approved cover 114; never publishes.',
        inputSchema: {
            projectId: z.literal(10), actorId: z.string(), taskId: z.literal(999),
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
