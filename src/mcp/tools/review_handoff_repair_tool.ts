import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { repairReviewHandoff, reviewHandoffRepairSchema, getReviewRepairSnapshot,
    reviewRepairSnapshotSchema } from '../../services/review_handoff_repair';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';

export function registerReviewHandoffRepairTool(server: McpServer): void {
    server.registerTool('ba_get_content_review_repair_snapshot', {
        description: 'Owner-only secret-free read-only snapshot for review/handoff collision recovery. Computes required hashes on the server; returns no body, channel config, credentials or review payload. Validates the current owner/tenant/collision/manual-only package without writes or provider access.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: reviewRepairSnapshotSchema.shape
    }, async args => asToolResult(await getReviewRepairSnapshot(args)));
    server.registerTool('ba_repair_content_review_handoff', {
        description: 'Owner-only preview/apply for an exact draft review-version collision on a manual-only channel, or the fixed owner-approved Telegram1103/r2/WI1756 recovery. Atomically supersedes the old review with immutable result/approval history retained, creates one fresh unclaimed revision-bound review, and rebuilds canonical handoff metadata. Does not accept copy, change dates/identity/art, release, publish or contact a provider. Snapshot drift and any delivery attempt/fact block.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: reviewHandoffRepairSchema.shape
    }, async args => asToolResult(await repairReviewHandoff(args)));
}
