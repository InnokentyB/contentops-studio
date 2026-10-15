import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import genericThreadsReleaseService from '../../services/threads_generic_release.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerGenericThreadsReleaseTool(server: McpServer): void {
    server.registerTool('ba_release_approved_threads_task', {
        description: 'Owner-only audited release registry for any canonical text-only Threads feed task. It verifies the exact accepted package, provider identity and bounded duplicate history, then records an immutable release. It never publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), taskId: z.number().int().positive(), actorId: z.string().regex(/^user:[1-9]\d*$/),
            approvalReference: z.string().min(10), expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            expectedAcceptedRevision: z.number().int().positive(), expectedContentRevision: z.number().int().positive(),
            expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/), expectedChannelId: z.number().int().positive(),
            expectedScheduleAt: z.string().datetime({ offset: true }), expectedVisualState: z.literal('NO_VISUAL_NEEDED'),
            expectedSelectedAssetId: z.null(), expectedPlacement: z.literal('feed'),
            expectedThreadsUserId: z.string().min(1), expectedUsername: z.string().min(1), idempotencyKey: z.string().min(1).max(500)
        }
    }, async args => asToolResult(await genericThreadsReleaseService.release(args)));
}
