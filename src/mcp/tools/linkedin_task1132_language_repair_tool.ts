import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    LINKEDIN1132_LANGUAGE,
    repairLinkedInTask1132Language
} from '../../services/linkedin_task1132_language_repair.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerLinkedInTask1132LanguageRepairTool(server: McpServer): void {
    server.registerTool('ba_repair_linkedin_task1132_language', {
        description: 'Owner-only audited preview/apply of the exact English language metadata repair for p7 LinkedIn task1132. It preserves accepted bytes, revision, schedule and gates; never releases or contacts LinkedIn.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: {
            projectId: z.literal(7), taskId: z.literal(1132),
            actorId: z.string().regex(/^user:\d+$/),
            expectedManifestChecksum: z.literal(LINKEDIN1132_LANGUAGE.manifest),
            expectedBodySha256: z.literal(LINKEDIN1132_LANGUAGE.bodySha),
            expectedScheduleAt: z.literal(LINKEDIN1132_LANGUAGE.schedule),
            idempotencyKey: z.string().min(1),
            confirm: z.boolean().optional().default(false)
        }
    }, async args => asToolResult(await repairLinkedInTask1132Language(args)));
}
