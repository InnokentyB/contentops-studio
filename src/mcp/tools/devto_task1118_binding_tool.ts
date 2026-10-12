import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bindDevtoTask1118, DEVTO1118_MANIFEST } from '../../services/devto_task1118_binding.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerDevtoTask1118BindingTool(server: McpServer): void {
    server.registerTool('ba_bind_devto_task1118', {
        description: 'Owner-only audited preview/apply for the exact p10 task1118 DEV.to binding. It creates or reuses the verified personal @innokentyb channel, rematerializes the English browser-required article handoff and replaces the stale feed art item with an article-cover item. It never releases, publishes, calls DEV.to or records a publication fact.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.literal(1118), actorId: z.string().regex(/^user:\d+$/),
            expectedManifestChecksum: z.literal(DEVTO1118_MANIFEST),
            expectedAcceptedRevision: z.literal(1), expectedContentRevision: z.literal(1),
            expectedBodySha256: z.literal('363ef73df900415ff965a77b1a71577354676d95077edbe84cf37ad0fabf3c12'),
            expectedScheduleAt: z.literal('2026-10-16T09:00:00.000Z'),
            expectedProfileRef: z.literal('profile_personal_innokenty_dev'),
            expectedProfileUrl: z.literal('https://dev.to/innokentyb'), expectedHandle: z.literal('innokentyb'),
            idempotencyKey: z.string().min(1), confirm: z.boolean().optional().default(false)
        }
    }, async args => asToolResult(await bindDevtoTask1118(args)));
}
