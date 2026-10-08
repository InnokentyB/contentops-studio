import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releaseLinkedInBrowserTaskWithPrisma } from '../../services/linkedin_browser_owner_release.service';
import { releaseDzenTaskWithPrisma } from '../../services/dzen_owner_release.service';
import dzenTaskPublicationService from '../../services/dzen_task_publication.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';
import { registerOct08ReviewRecoveryTool } from './oct08_review_recovery';

const ownerInput = {
    actorId: z.string(), approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
    expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/)
};

export const linkedInTask1077ReleaseSchema = z.object({
    ...ownerInput, projectId: z.literal(7), taskId: z.literal(1077), expectedChannelId: z.literal(5),
    expectedContentRevision: z.literal(1), expectedAcceptedRevision: z.literal(1),
    expectedSelectedAssetId: z.null(), expectedAssetSha256: z.null(),
    expectedVisualDecisionId: z.literal(252),
    expectedBodySha256: z.literal('5f9df7dcbcb1d999742e7a3f918b2ba9fb4fff92d5470009dee0b3034c5ec53a'),
    expectedScheduleAt: z.literal('2026-10-08T09:00:00.000Z')
});

export const dzenTask1036ReleaseSchema = z.object({
    ...ownerInput, projectId: z.literal(10), taskId: z.literal(1036), expectedChannelId: z.literal(116),
    expectedContentRevision: z.literal(2), expectedAcceptedRevision: z.literal(2),
    expectedVisualState: z.literal('APPROVED'), expectedPlacement: z.literal('article_cover'),
    expectedVisualDecisionVersion: z.literal(1), expectedSelectedAssetId: z.literal(122),
    expectedBodySha256: z.literal('84f8f3ea79c4f252216e7568aa12a84eff08f685f33d4da360b94c8d8073e0fa'),
    expectedAssetSha256: z.literal('8cbe7cecab92124712292d4d2b6723cee113d6dadec6d0a3ac6d952aeec925ba'),
    expectedScheduleAt: z.literal('2026-10-08T11:30:00.000Z'),
    expectedPublishAt: z.literal('2026-10-08T11:30:00.000Z')
});

/** Exact delegated packages only; canonical services retain owner, tenant and attempt guards. */
export function registerOct08ExactReleaseTools(server: McpServer): void {
    registerOct08ReviewRecoveryTool(server);
    server.registerTool('ba_release_linkedin_task1077_browser', {
        description: 'Audited owner release of exact p7/ch5 LinkedIn1077 rev1 with an active NO_VISUAL_NEEDED waiver. Never sends. Do not use after a reported manual publication: reconcile the existing provider object first.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedInTask1077ReleaseSchema.shape
    }, async args => asToolResult(await releaseLinkedInBrowserTaskWithPrisma(args)));
    server.registerTool('ba_release_dzen_task1036', {
        description: 'Audited owner release of exact p10/ch116 Dzen1036 accepted rev2 and approved cover122. Verifies manifest, hashes, schedule, active art decision and absence of attempts. Never sends; separate connector verification and explicit publication required.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: dzenTask1036ReleaseSchema.shape
    }, async args => asToolResult(await releaseDzenTaskWithPrisma(args)));
    server.registerTool('ba_verify_dzen_task1036_connector', {
        description: 'Owner-only authenticated editor probe for released Dzen1036 rev2/cover122. Records short-lived exact-task proof, never publishes.',
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1036), actorId: z.string(),
            idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await dzenTaskPublicationService.verifyConnector(args)));
}
