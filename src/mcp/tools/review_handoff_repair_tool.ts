import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { repairReviewHandoff, reviewHandoffRepairSchema } from '../../services/review_handoff_repair';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerReviewHandoffRepairTool(server: McpServer): void {
    server.registerTool('ba_repair_content_review_handoff', {
        description: 'Owner-only preview/apply for an exact draft review-version collision on a manual-only channel. Atomically supersedes the old review with immutable result/approval history retained, creates one fresh unclaimed revision-bound review, and rebuilds manual handoff metadata. Does not accept copy, change dates/identity/art, release, publish or contact a provider. Snapshot drift and any delivery attempt/fact block.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: reviewHandoffRepairSchema.shape
    }, async args => asToolResult(await repairReviewHandoff(args)));
}
