import { createHash } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import prisma from '../../db';
import { recoverContentReview } from '../../services/work_queue/recovery_operations';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

const packages = {
    1040: { revision: 4, workItemId: 1605,
        bodySha256: '6c7e36761a0f7cf48859f8f9ef673f3aa38105fa61c10d4ea592cbbeddc60353' },
    1089: { revision: 2, workItemId: 1614,
        bodySha256: '91e95dee382ad72b7d8ff7daccfd7c963590de118c6e47393c79b6c99d8035db' }
} as const;

export const oct08ReviewRecoverySchema = z.object({
    projectId: z.literal(10), taskId: z.union([z.literal(1040), z.literal(1089)]),
    actorId: z.string(), idempotencyKey: z.string().min(1), evidence: z.string().min(10)
});

/** Restrict delegated recovery to owner-approved immutable packages; never approves or publishes. */
export async function recoverOct08ContentReview(args: z.infer<typeof oct08ReviewRecoverySchema>): Promise<Record<string, unknown>> {
    const validated = oct08ReviewRecoverySchema.parse(args);
    const spec = packages[validated.taskId];
    const content = await prisma.contentItem.findFirst({ where: {
        id: validated.taskId, project_id: validated.projectId
    }, select: { content_revision: true, draft_text: true } });
    if (!content || content.content_revision !== spec.revision
        || createHash('sha256').update(content.draft_text || '').digest('hex') !== spec.bodySha256) {
        throw new Error('[EXACT_REVIEW_RECOVERY_PACKAGE_MISMATCH] Current revision/body does not match authorized package');
    }
    // Canonical transaction enforces authenticated actor's project owner membership and idempotency.
    return recoverContentReview({ ...validated, workItemId: spec.workItemId,
        expectedContentRevision: spec.revision });
}

/** Expose only exact recovery through editor scope; generic owner recovery remains unexposed. */
export function registerOct08ReviewRecoveryTool(server: McpServer): void {
    server.registerTool('ba_recover_oct08_content_review', {
        description: 'Audited project-owner recovery only for p10 task1040 rev4/WI1605 or task1089 rev2/WI1614 with pinned body hashes. Preserves historical approvals and creates a separately reviewable work item when needed. Never approves or publishes.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: oct08ReviewRecoverySchema.shape
    }, async args => asToolResult(await recoverOct08ContentReview(args)));
}
