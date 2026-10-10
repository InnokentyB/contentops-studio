import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    claimLinkedInTask1072Browser,
    claimXTask1042Browser,
    OCT10_MANIFEST_CHECKSUM,
    releaseLinkedInTask1072,
    releaseThreadsTask1043
} from '../../services/oct10_owner_recovery.service';
import {
    prepareXTask1042TextOnlyPackage,
    recoverXTask1042OverlengthRelease,
    releaseXTask1042TextOnly,
    X1042_TEXT_ONLY_MANIFEST
} from '../../services/x_task1042_text_only.service';
import threadsTaskPublicationService from '../../services/threads_task_publication.service';
import telegramTaskPublicationService from '../../services/telegram_task_publication.service';
import { releaseDzenTaskWithPrisma } from '../../services/dzen_owner_release.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import { reconcileOrResumeDzenTask1045Draft } from '../../services/dzen_task1045_draft_resume.service';
import { DZEN1045 } from '../../services/dzen_task1045_resume_contract';
import { previewVkTask1048Api, promoteVkTask1048Api, VK1048_MANIFEST } from '../../services/vk_task1048_api_promotion.service';
import {
    releaseThreadsTask1046,
    THREADS1046_MANIFEST_CHECKSUM
} from '../../services/threads_task1046_release.service';
import {
    repairTelegramTask1099Story,
    releaseTelegramTask1099Story,
    TELEGRAM1099_MANIFEST_CHECKSUM
} from '../../services/telegram_task1099_story_recovery.service';
import { asToolResult, EXTERNAL_PUBLICATION_ANNOTATIONS, INTERNAL_MUTATION_ANNOTATIONS } from './common';

const approval = {
    projectId: z.literal(10), actorId: z.string().regex(/^user:\d+$/),
    expectedManifestChecksum: z.literal(OCT10_MANIFEST_CHECKSUM),
    recoverySlotDate: z.literal('2026-10-10'), approvalReference: z.string().min(10),
    idempotencyKey: z.string().min(1)
};

export const x1042TextOnlyPrepareSchema = z.object({ projectId: z.literal(10), taskId: z.literal(1042),
    actorId: z.string().regex(/^user:\d+$/), expectedManifestChecksum: z.literal(X1042_TEXT_ONLY_MANIFEST),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
});

export const x1042OverlengthRecoverySchema = z.object({ projectId: z.literal(10), taskId: z.literal(1042),
    actorId: z.string().regex(/^user:\d+$/), expectedManifestChecksum: z.literal(X1042_TEXT_ONLY_MANIFEST),
    expectedBrowserWorkItemId: z.literal(1689), expectedWriterWorkItemId: z.literal(1308),
    expectedReviewWorkItemId: z.literal(1420), expectedArtWorkItemId: z.literal(1688),
    expectedDecisionId: z.literal(271), expectedWeightedLength: z.literal(365), expectedLimit: z.literal(280),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
});

export const x1042ReleaseSchema = z.object({ projectId: z.literal(10), actorId: z.string().regex(/^user:\d+$/),
    expectedManifestChecksum: z.literal(X1042_TEXT_ONLY_MANIFEST), recoverySlotDate: z.literal('2026-10-10'),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
    taskId: z.literal(1042), expectedChannelId: z.literal(164),
    expectedContentRevision: z.literal(6), expectedAcceptedRevision: z.literal(6),
    expectedBodySha256: z.literal('8ee902b053a244255c4c3d728947e755069e5aca8503f3ed201476bf67f0cfc3'),
    expectedSelectedAssetId: z.null(), expectedAssetSha256: z.null(), expectedReviewWorkItemId: z.literal(1420),
    expectedArtWorkItemId: z.number().int().positive(), expectedDecisionId: z.number().int().positive(),
    expectedWeightedLength: z.literal(273), expectedLimit: z.literal(280),
    expectedScheduleAt: z.literal('2026-10-09T15:00:00.000Z')
});

export const linkedIn1072ReleaseSchema = z.object({ ...approval, taskId: z.literal(1072),
    expectedCurrentChannelId: z.literal(123), sourceRegistryProjectId: z.literal(7),
    sourceRegistryChannelId: z.literal(5), targetProfileRef: z.literal('profile_personal_innokenty_linkedin'),
    targetProfileUrl: z.literal('https://www.linkedin.com/in/innokentyb/'),
    expectedContentRevision: z.literal(4), expectedAcceptedRevision: z.literal(4),
    expectedBodySha256: z.literal('d5b88c95e2fbe35cf96e792c775b0e84eff4c261974487d592a8cc24ac44951c'),
    expectedSelectedAssetId: z.literal(127),
    expectedAssetSha256: z.literal('3c2c2f95dcdd54784a034216414a8efc6b97fe79167ea3403de9e5e918db1121'),
    expectedScheduleAt: z.literal('2026-10-09T15:00:00.000Z')
});

export const threads1043ReleaseSchema = z.object({ ...approval, taskId: z.literal(1043), expectedChannelId: z.literal(138),
    expectedThreadsUserId: z.literal('39421253764155091'), expectedUsername: z.literal('innokentybo'),
    expectedCurrentContentRevision: z.literal(4), expectedCurrentAcceptedRevision: z.literal(4),
    expectedCurrentBodySha256: z.literal('00813c7d65068bdce2e0b5aa6bb1cc04ca936e42c81ca4a44b2be50a095713fc'),
    expectedCurrentSelectedAssetId: z.literal(128),
    expectedCurrentAssetSha256: z.literal('d53fa8809efe40b35577849cdfcd2795ead8127ba77e9e4a604fbfaf94f9d3c3'),
    expectedHistoricalContentRevision: z.literal(3),
    expectedHistoricalBodySha256: z.literal('c68bd80edc8c866930e06844f1f9bde96ab3c4325cf1bd8d21760f1f8fb691bd'),
    expectedHistoricalApprovalId: z.literal(255), expectedHistoricalDecisionId: z.literal(217),
    expectedTargetContentRevision: z.literal(5), expectedTargetSelectedAssetId: z.null(),
    expectedScheduleAt: z.literal('2026-10-09T16:30:00.000Z')
});

export const threads1046ReleaseSchema = z.object({
    projectId: z.literal(10), taskId: z.literal(1046), actorId: z.string().regex(/^user:\d+$/),
    expectedManifestChecksum: z.literal(THREADS1046_MANIFEST_CHECKSUM),
    expectedChannelId: z.literal(138), expectedThreadsUserId: z.literal('39421253764155091'),
    expectedUsername: z.literal('innokentybo'), expectedContentRevision: z.literal(4),
    expectedAcceptedRevision: z.literal(4),
    expectedBodySha256: z.literal('e3403bd77725ff503627cdecca3a2ce423f148af75ac25830add9652ae25adb9'),
    expectedVisualState: z.literal('APPROVED'), expectedPlacement: z.literal('feed'),
    expectedDecisionId: z.literal(270), expectedDecisionVersion: z.literal(1),
    expectedSelectedAssetId: z.literal(132),
    expectedAssetSha256: z.literal('1b9177bbdc77a4d29f0c950f14f85f16f018c2a45544aa8f75ff6e8f00db2e03'),
    expectedScheduleAt: z.literal('2026-10-10T16:30:00.000Z'),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
});

const telegram1099Exact = {
    projectId: z.literal(10), taskId: z.literal(1099), actorId: z.string().regex(/^user:\d+$/),
    expectedManifestChecksum: z.literal(TELEGRAM1099_MANIFEST_CHECKSUM), expectedInitiativeId: z.literal(296),
    expectedChannelId: z.literal(108), expectedCurrentType: z.literal('publication'),
    expectedCurrentPlacement: z.literal('feed'), expectedTargetType: z.literal('telegram_story'),
    expectedTargetPlacement: z.literal('story'), expectedContentRevision: z.literal(1),
    expectedAcceptedRevision: z.literal(1),
    expectedBodySha256: z.literal('f46104f5ed4e1b892d07eb1474015890165bc61a3d9bd0c7bce3edc061f2a2be'),
    expectedDecisionId: z.literal(277), expectedDecisionVersion: z.literal(1),
    expectedSelectedAssetId: z.literal(134), expectedSourceAssetId: z.literal(133),
    expectedSourcePublicationFactId: z.literal(442),
    expectedAssetSha256: z.literal('ab299952f375cef3346c9a43dc529db1a74ac281dc16f290ab8de0b6cb796c6c'),
    prohibitedRenderJobId: z.literal('6474ed84-5a6a-494d-a06c-7183e9ace9bb'),
    expectedScheduleAt: z.literal('2026-10-10T13:30:00.000Z'), idempotencyKey: z.string().min(1)
};

export const telegram1099RepairSchema = z.object(telegram1099Exact);
export const telegram1099ReleaseSchema = z.object({ ...telegram1099Exact,
    expectedCurrentType: z.literal('telegram_story'), expectedCurrentPlacement: z.literal('story'),
    expectedTelegramAccountId: z.literal(2), expectedSourceStoryTaskId: z.literal(986),
    expectedSourceStoryFactId: z.literal(363), approvalReference: z.string().min(10) });

export const dzen1045ReleaseSchema = z.object({ ...approval, taskId: z.literal(1045), expectedChannelId: z.literal(116),
    expectedContentRevision: z.literal(4), expectedAcceptedRevision: z.literal(4),
    expectedBodySha256: z.literal('37b70ca472211b64104168115d435d4c2d4ef6c9fb3c61c9041ec0f9336242f1'),
    expectedVisualState: z.literal('APPROVED'), expectedPlacement: z.literal('article_cover'),
    expectedVisualDecisionVersion: z.literal(1), expectedSelectedAssetId: z.literal(129),
    expectedAssetSha256: z.literal('6b02adaf5ce140d986d85de5cf910a33bed36f65384e166031712fd66a06d76b'),
    expectedScheduleAt: z.literal('2026-10-10T10:00:00.000Z'),
    expectedPublishAt: z.literal('2026-10-10T10:00:00.000Z')
});

const claim = { projectId: z.literal(10), actorId: z.string(), workItemId: z.number().int().positive(),
    leaseSeconds: z.number().int().positive().max(3600).optional(), idempotencyKey: z.string().min(1) };

/** Exact owner recovery and publisher handoff tools for the missed 9 October slots. */
export function registerOct10OwnerRecoveryTools(server: McpServer): void {
    server.registerTool('ba_prepare_x_task1042_text_only_package', {
        description: 'Owner-only audited scope correction for X task1042. Keeps the accepted body byte-for-byte, reopens it as revision5 through the canonical revision-stale boundary, and exposes the standard content-review gate. The old approved asset remains immutable but is no longer selected. Never releases or publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: x1042TextOnlyPrepareSchema.shape
    }, async args => asToolResult(await prepareXTask1042TextOnlyPackage(args)));
    server.registerTool('ba_recover_x_task1042_overlength_release', {
        description: 'Owner-only audited recovery for the exact claimed X task1042 revision5 browser item rejected pre-submit at 365/280 weighted characters. Cancels only that browser item, supersedes its release proof, and reopens Writer item1308. It preserves copy as history and never edits, releases, claims, or publishes the replacement.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: x1042OverlengthRecoverySchema.shape
    }, async args => asToolResult(await recoverXTask1042OverlengthRelease(args)));
    server.registerTool('ba_release_x_task1042_browser', {
        description: 'Owner-only audited exact text-only release of p10 X task1042 revision6 after approved review result6 and an active revision6 NO_VISUAL_NEEDED decision4. Enforces the ordinary-X 280 weighted-character limit, requires selected_asset_id=null, creates one browser item that forbids an image, and never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: x1042ReleaseSchema.shape
    }, async args => asToolResult(await releaseXTask1042TextOnly(args)));
    server.registerTool('ba_claim_x_task1042_browser_publication', {
        description: 'Publisher-only exact claim for the browser work item created by the task1042 owner release. Does not contact X.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: claim
    }, async args => asToolResult(await claimXTask1042Browser(args)));

    server.registerTool('ba_release_linkedin_task1072_personal_browser', {
        description: 'Owner-only audited atomic identity repair and release for p10 LinkedIn task1072 rev4/asset127. Creates or verifies a p10 personal route governed by registry p7/channel5 and targets only https://www.linkedin.com/in/innokentyb/. Never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedIn1072ReleaseSchema.shape
    }, async args => asToolResult(await releaseLinkedInTask1072(args)));
    server.registerTool('ba_claim_linkedin_task1072_browser_publication', {
        description: 'Publisher-only exact claim for task1072 bound to the governed Innokenty personal LinkedIn route. Does not contact LinkedIn.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: claim
    }, async args => asToolResult(await claimLinkedInTask1072Browser(args)));

    server.registerTool('ba_release_threads_task1043_api', {
        description: 'Owner-only exact recovery of the previously approved text-only task1043 package. It verifies current rev4/asset128 and historical rev3 approval255/decision217, creates an explicit current rev5 NO_VISUAL_NEEDED binding while preserving asset128 as immutable history, and never sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: threads1043ReleaseSchema.shape
    }, async args => asToolResult(await releaseThreadsTask1043(args)));
    server.registerTool('ba_publish_threads_task1043', {
        description: 'Exact canonical dry-run or one-shot API publication for owner-released Threads task1043. Requires an idempotency key for live mode; an uncertain provider result freezes retry and records no fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1043), dryRun: z.boolean().optional().default(true),
            idempotencyKey: z.string().min(1).optional() }
    }, async args => asToolResult(await threadsTaskPublicationService.execute(args)));
    server.registerTool('ba_release_threads_task1046_api', {
        description: 'Owner-only audited release of exact p10 Threads task1046 rev4/decision270/asset132. Verifies manifest, provider identity, bounded post history, durable image and absence of facts or attempts. Never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: threads1046ReleaseSchema.shape
    }, async args => asToolResult(await releaseThreadsTask1046(args)));
    server.registerTool('ba_publish_threads_task1046', {
        description: 'Exact canonical dry-run or one-shot task-native image API publication for owner-released Threads task1046. Live mode requires a fresh idempotency key; uncertain provider results freeze retry and record no fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1046), dryRun: z.boolean().optional().default(true),
            idempotencyKey: z.string().min(1).optional() }
    }, async args => asToolResult(await threadsTaskPublicationService.execute(args)));
    server.registerTool('ba_repair_telegram_task1099_story_placement', {
        description: 'Owner-only audited exact correction of p10 task1099 from the legacy feed projection to the initiative296 personal Telegram Story contract. Preserves accepted caption, asset134, schedule and history; refuses facts or attempts and never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: telegram1099RepairSchema.shape
    }, async args => asToolResult(await repairTelegramTask1099Story(args)));
    server.registerTool('ba_release_telegram_task1099_personal_story', {
        description: 'Owner-only audited release of exact corrected task1099 for personal MTProto Story delivery. Binds the sole active account2 and the verified task986/fact363 Story precedent. Never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: telegram1099ReleaseSchema.shape
    }, async args => asToolResult(await releaseTelegramTask1099Story(args)));
    server.registerTool('ba_publish_telegram_task1099_personal_story', {
        description: 'Exact dry-run or explicit one-shot personal MTProto video Story send for owner-released task1099. No channel/feed fallback; an uncertain provider result freezes retry and records no fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1099), dryRun: z.boolean().optional().default(true),
            idempotencyKey: z.string().min(1).optional() }
    }, async args => asToolResult(await telegramTaskPublicationService.execute(args)));
    server.registerTool('ba_release_dzen_task1045', {
        description: 'Owner-only audited release of exact p10 Dzen task1045 rev4/cover129. It verifies manifest, hashes, schedule and absence of attempts; it never contacts Dzen.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: dzen1045ReleaseSchema.shape
    }, async args => asToolResult(await releaseDzenTaskWithPrisma(args)));
    server.registerTool('ba_verify_dzen_task1045_connector', {
        description: 'Owner-only authenticated Dzen editor probe for released task1045. Records a short-lived exact-task proof and never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1045), actorId: z.string().regex(/^user:\d+$/),
            idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await dzenTaskPublicationService.verifyConnector(args)));
    server.registerTool('ba_reconcile_dzen_task1045_uncertain_attempt', {
        description: 'Owner-only audited readback of the exact frozen Dzen1045 attempt. It inspects authenticated Studio state, returns one exact published permalink/provider ID, distinguishes a matching draft, and marks retry-safe only from explicit complete zero-match coverage. It never publishes, retries, or records a fact.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1045), actorId: z.string().regex(/^user:\d+$/),
            expectedAttemptIdempotencyKey: z.literal('dzen-p10-1045-r4-asset129-recovery-20261010-01'),
            idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await dzenTaskPublicationService.reconcileTask1045(args)));
    server.registerTool('ba_reconcile_or_resume_dzen_task1045_draft', {
        description: 'Owner-only exact task1045 existing-draft recovery. Exhaustively enumerates authenticated Published and Draft Studio pages, verifies the accepted body and cover, and defaults to preview. confirm=true CAS-claims the original incident and clicks the final control once on the same draft. Never rebuilds or resends content.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1045),
            actorId: z.string().regex(/^user:\d+$/),
            expectedAttemptIdempotencyKey: z.literal(DZEN1045.originalKey),
            idempotencyKey: z.literal(DZEN1045.resumeKey), confirm: z.boolean().optional().default(false) }
    }, async args => asToolResult(await reconcileOrResumeDzenTask1045Draft(args)));
    server.registerTool('ba_preview_vk_task1048_api_promotion', {
        description: 'Owner-only exact read-only preview of task1048 promotion from the unclaimed browser item to canonical vk_api. Reports credential readiness without exposing secrets and never calls VK.',
        annotations: { readOnlyHint: true },
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1048), actorId: z.string().regex(/^user:\d+$/) }
    }, async args => asToolResult(await previewVkTask1048Api(args)));
    server.registerTool('ba_apply_vk_task1048_api_promotion', {
        description: 'Owner-only audited CAS promotion of exact task1048 rev1/asset130 to connector_auto, allowed only when channel117 has current community publish and user media credentials. Cancels only unclaimed browser item1699; never calls VK or records a fact.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1048), actorId: z.string().regex(/^user:\d+$/),
            expectedManifestChecksum: z.literal(VK1048_MANIFEST), approvalReference: z.string().min(10),
            idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await promoteVkTask1048Api(args)));
}
