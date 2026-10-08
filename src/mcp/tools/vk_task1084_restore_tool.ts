import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { restoreVkTask1084 } from '../../services/vk_task1084_restore.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerVkTask1084RestoreTool(server: McpServer) {
    server.registerTool('ba_restore_vk_task1084_from_erroneous_retirement', {
        description: 'Owner-only exact audited restore of p10 task 1084 from retirement audit 2629. Preserves accepted rev1/asset118 and the old schedule, creates no fact or delivery, and returns the task as blocked on the unsupported VK native-video transport.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(10), projectSlug: z.literal('analystcraft-2'), taskId: z.literal(1084),
            actorId: z.string().regex(/^user:\d+$/),
            expectedManifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            registrySnapshotVersion: z.number().int().positive(), registrySnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
            expectedRetirementAuditId: z.literal(2629),
            expectedBodySha256: z.literal('604452f079a35149d6934713f3f30b451d24cd4db726488b4724125a3db14594'),
            expectedAssetSha256: z.literal('8032717b6898e1dd915e585a481aa27696d7aa383b0a51277a4e912f89caeca1'),
            approvalReference: z.string().trim().min(10), reason: z.string().trim().min(20),
            dryRun: z.boolean().default(true), idempotencyKey: z.string().trim().min(1).optional()
        }
    }, async args => asToolResult(await restoreVkTask1084(args)));
}
