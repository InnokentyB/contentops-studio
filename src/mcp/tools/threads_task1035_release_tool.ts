import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releasePendingThreadsTask } from '../../services/threads_pending_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

/** Exact owner release; verifies fixed revision/hash/WIs/manifest and never sends. */
export function registerThreadsTask1035ReleaseTool(server: McpServer): void {
    server.registerTool('ba_release_approved_threads_task1035', {
        description: 'Owner-only audited release of project10/task1035 accepted revision1, channel138, decision244, review1550/art1561. Preserves native Threads identity, verifies history and fixed package. Never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1035), actorId: z.string(),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1) }
    }, async args => asToolResult(await releasePendingThreadsTask(args)));
}
