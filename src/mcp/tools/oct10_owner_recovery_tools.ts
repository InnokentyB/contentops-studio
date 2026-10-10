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
    releaseXTask1042TextOnly,
    X1042_TEXT_ONLY_MANIFEST
} from '../../services/x_task1042_text_only.service';
import threadsTaskPublicationService from '../../services/threads_task_publication.service';
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

export const x1042ReleaseSchema = z.object({ ...approval, taskId: z.literal(1042), expectedChannelId: z.literal(164),
    expectedContentRevision: z.literal(5), expectedAcceptedRevision: z.literal(5),
    expectedBodySha256: z.literal('7d780809a7f6b73494b590cd1fa11ac2f6383fdc0a952f1aca5d09cb4e676c70'),
    expectedSelectedAssetId: z.null(), expectedAssetSha256: z.null(), expectedReviewWorkItemId: z.literal(1420),
    expectedArtWorkItemId: z.number().int().positive(), expectedDecisionId: z.number().int().positive(),
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
    expectedContentRevision: z.literal(4), expectedAcceptedRevision: z.literal(4),
    expectedBodySha256: z.literal('00813c7d65068bdce2e0b5aa6bb1cc04ca936e42c81ca4a44b2be50a095713fc'),
    expectedSelectedAssetId: z.literal(128),
    expectedAssetSha256: z.literal('d53fa8809efe40b35577849cdfcd2795ead8127ba77e9e4a604fbfaf94f9d3c3'),
    expectedScheduleAt: z.literal('2026-10-09T16:30:00.000Z')
});

const claim = { projectId: z.literal(10), actorId: z.string(), workItemId: z.number().int().positive(),
    leaseSeconds: z.number().int().positive().max(3600).optional(), idempotencyKey: z.string().min(1) };

/** Exact owner recovery and publisher handoff tools for the missed 9 October slots. */
export function registerOct10OwnerRecoveryTools(server: McpServer): void {
    server.registerTool('ba_prepare_x_task1042_text_only_package', {
        description: 'Owner-only audited scope correction for X task1042. Keeps the accepted body byte-for-byte, reopens it as revision5 through the canonical revision-stale boundary, and exposes the standard content-review gate. The old approved asset remains immutable but is no longer selected. Never releases or publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: x1042TextOnlyPrepareSchema.shape
    }, async args => asToolResult(await prepareXTask1042TextOnlyPackage(args)));
    server.registerTool('ba_release_x_task1042_browser', {
        description: 'Owner-only audited exact text-only release of p10 X task1042 revision5 after approved review result5 and an active revision5 NO_VISUAL_NEEDED decision3. Requires selected_asset_id=null, creates one browser item that forbids an image, and never publishes.',
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
        description: 'Owner-only exact release of p10 Threads task1043 rev4/asset128 after identity and own-history verification. Keeps the missed 9 October schedule, records the 10 October recovery, and never sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: threads1043ReleaseSchema.shape
    }, async args => asToolResult(await releaseThreadsTask1043(args)));
    server.registerTool('ba_publish_threads_task1043', {
        description: 'Exact canonical dry-run or one-shot API publication for owner-released Threads task1043. Requires an idempotency key for live mode; an uncertain provider result freezes retry and records no fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1043), dryRun: z.boolean().optional().default(true),
            idempotencyKey: z.string().min(1).optional() }
    }, async args => asToolResult(await threadsTaskPublicationService.execute(args)));
}
