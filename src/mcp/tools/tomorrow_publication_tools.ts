import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { releasePendingThreadsTask } from '../../services/threads_pending_release.service';
import threadsTaskPublicationService from '../../services/threads_task_publication.service';
import { asToolResult, EXTERNAL_PUBLICATION_ANNOTATIONS, INTERNAL_MUTATION_ANNOTATIONS } from './common';

const MANIFEST = 'sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b';

/** Exact route for the accepted, native Threads package scheduled for 13 October. */
export function registerTomorrowPublicationTools(server: McpServer): void {
    server.registerTool('ba_release_threads_task1110_api', {
        description: 'Owner-only audited release of exact p10 Threads task1110 revision2/decision299. Verifies personal identity, provider history, manifest, native length and absence of facts or attempts. Never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1110),
            actorId: z.string().regex(/^user:\d+$/),
            expectedManifestChecksum: z.literal(MANIFEST),
            approvalReference: z.string().min(10), idempotencyKey: z.string().min(1)
        }
    }, async args => asToolResult(await releasePendingThreadsTask(args)));
    server.registerTool('ba_publish_threads_task1110', {
        description: 'Exact dry-run or one-shot task-native API publication for owner-released Threads task1110 revision2. An uncertain provider result freezes retry and records no publication fact.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1110),
            dryRun: z.boolean().optional().default(true), idempotencyKey: z.string().min(1).optional()
        }
    }, async args => asToolResult(await threadsTaskPublicationService.execute(args)));
}
