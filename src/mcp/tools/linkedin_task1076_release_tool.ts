import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releaseLinkedInBrowserTaskWithPrisma } from '../../services/linkedin_browser_owner_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

/** Exact package boundary; the existing service still verifies owner, hashes and CAS. */
export const linkedInTask1076ReleaseSchema = z.object({
    projectId: z.literal(7), taskId: z.literal(1076), actorId: z.string(),
    expectedChannelId: z.literal(6),
    expectedContentRevision: z.literal(1), expectedAcceptedRevision: z.literal(1),
    expectedSelectedAssetId: z.literal(116),
    expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/),
    expectedAssetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    expectedScheduleAt: z.string().datetime({ offset: true }),
    expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
});

/** Release only task 1076 to its sole browser sender; never sends or claims. */
export function registerLinkedInTask1076ReleaseTool(server: McpServer): void {
    server.registerTool('ba_release_linkedin_task1076_browser', {
        description: 'Owner-only audited release of project 7 task 1076, channel 6, accepted revision 1 and approved asset 116. Verifies current body/asset hashes, manifest and schedule through the canonical owner CAS. Never publishes or claims browser work.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: linkedInTask1076ReleaseSchema.shape
    }, async args => asToolResult(await releaseLinkedInBrowserTaskWithPrisma(args)));
}
