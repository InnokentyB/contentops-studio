import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { holdVkTask1084 } from '../../services/vk_task1084_hold.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerVkTask1084HoldTool(server: McpServer) {
    server.registerTool('ba_hold_vk_task1084', {
        description: 'Owner-only exact p10 VK1084 internal safety hold. Defaults to secret-free lease/attempt preview. Never sends, clears leases, changes accepted records or creates publication facts.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { projectId: z.literal(10), taskId: z.literal(1084), actorId: z.string(),
            dryRun: z.boolean().default(true), expectedBodySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
            idempotencyKey: z.string().min(1).optional(), approvalReference: z.string().min(10).optional() }
    }, async args => asToolResult(await holdVkTask1084(args)));
}
