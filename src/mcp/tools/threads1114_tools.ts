import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { threads1114ArgsSchema } from '../../services/threads1114_contract';
import { publishExactThreads1114, releaseExactThreads1114 } from '../../services/threads1114_runtime';
import { asToolResult, EXTERNAL_PUBLICATION_ANNOTATIONS } from './common';

export function registerThreads1114Tools(server: McpServer) {
    server.registerTool('ba_release_threads_task1114_api', {
        description: 'Exact owner release for p10 task1114 rev1; reads identity/history through Threads API, atomically audits immutable package release. Never sends.',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        inputSchema: threads1114ArgsSchema.shape
    }, async args => asToolResult(await releaseExactThreads1114(args)));
    server.registerTool('ba_publish_threads_task1114', {
        description: 'Exact owner-released task1114: dry-run by default; one fenced API attempt, verified numeric provider ID/readback, atomic canonical fact. Unknown outcome forbids resend.',
        annotations: EXTERNAL_PUBLICATION_ANNOTATIONS,
        inputSchema: { ...threads1114ArgsSchema.shape, dryRun: z.boolean().optional().default(true) }
    }, async args => asToolResult(await publishExactThreads1114(args)));
}
