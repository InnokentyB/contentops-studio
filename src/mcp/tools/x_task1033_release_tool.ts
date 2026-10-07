import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releaseXTask1033 } from '../../services/x_task1033_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerXTask1033ReleaseTool(server: McpServer): void {
    server.registerTool('ba_release_x_task1033_browser', {
        description: 'Owner-only exact audited browser release for p10 X1033 accepted revision2, channel164. Creates one revision-bound work item; never sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1033), actorId: z.string(),
            expectedChannelId: z.literal(164), expectedContentRevision: z.literal(2), expectedAcceptedRevision: z.literal(2),
            expectedBodySha256: z.literal('9ba2558e09ef10b82babb3b3d605a3a281d5b8314ef9d78f652950bdf17d2cb8'),
            expectedDecisionId: z.literal(243), expectedReviewWorkItemId: z.literal(1549), expectedArtWorkItemId: z.literal(1560),
            expectedScheduleAt: z.literal('2026-10-07T15:00:00.000Z'),
            expectedManifestChecksum: z.literal('sha256:e7f837d363d88c6a30c5e5daac002894f85ccd7e73249fa45ef07d7efc27e46f'),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async args => asToolResult(await releaseXTask1033(args)));
}
