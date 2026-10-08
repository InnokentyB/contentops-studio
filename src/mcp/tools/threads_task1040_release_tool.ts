import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releasePendingThreadsTask } from '../../services/threads_pending_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export const threads1040ReleaseSchema = z.object({
    projectId: z.literal(10), taskId: z.literal(1040), actorId: z.string(),
    approvalReference: z.string().min(10), idempotencyKey: z.string().min(1),
    expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    newScheduleAt: z.string().datetime({ offset: true })
});

/** Exact owner release and near-now correction are atomic; provider send is separate. */
export function registerThreadsTask1040ReleaseTool(server: McpServer): void {
    server.registerTool('ba_release_approved_threads_task1040', {
        description: 'Owner-only exact p10/ch138 task1040 rev4/body hash release after completed review1623/result4 and active art256/version2 NO_VISUAL_NEEDED. Checks manifest, identity, complete own-history duplicate scan, absence of attempts/facts/browser claims. Atomically changes schedule_at/publish_at from 2026-10-08T16:30Z to within ten minutes of now. Never sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: threads1040ReleaseSchema.shape
    }, async args => asToolResult(await releasePendingThreadsTask(args)));
}
