import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releaseLinkedInBrowserTaskWithPrisma } from '../../services/linkedin_browser_owner_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

/** Exact package boundary for the owner-approved Tracy Rolling recommendation. */
export const linkedInTask1090ReleaseSchema = z.object({
    projectId: z.literal(7),
    taskId: z.literal(1090),
    actorId: z.string(),
    expectedChannelId: z.literal(5),
    expectedContentRevision: z.literal(2),
    expectedAcceptedRevision: z.literal(2),
    expectedSelectedAssetId: z.literal(123),
    expectedBodySha256: z.literal('8a93e640b02f2c9de6c2119c4556fbbe9cbb67339f9ffed73721700f1a476d39'),
    expectedAssetSha256: z.literal('a1fff6e14da32a07fe5853d25ae0288f002907b1405ed90f02090a537fa38aef'),
    expectedScheduleAt: z.literal('2026-10-09T09:00:00.000Z'),
    expectedManifestChecksum: z.literal('sha256:ed6923b99f46d80a029a877bd4c02c09852c61ebdb2a02a26bee99e6f18015f8'),
    approvalReference: z.string().min(10),
    idempotencyKey: z.string().min(1)
});

/** Restore the missing browser work item for task 1090 without contacting LinkedIn. */
export function registerLinkedInTask1090ReleaseTool(server: McpServer): void {
    server.registerTool('ba_release_linkedin_task1090_browser', {
        description: 'Owner-only audited release of exact p7/ch5 LinkedIn task1090 accepted rev2 and approved asset123. It may recover the already prepared browser_required state only when no attempt, fact, permalink or active browser work item exists. Never sends or claims browser work.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: linkedInTask1090ReleaseSchema.shape
    }, async args => asToolResult(await releaseLinkedInBrowserTaskWithPrisma({
        ...args,
        allowPreparedBrowserState: true
    })));
}
