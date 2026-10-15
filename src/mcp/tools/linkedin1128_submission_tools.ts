import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { linkedin1128SubmissionSchema } from '../../services/linkedin1128_submission_guard';
import { startLinkedIn1128, preSubmitLinkedIn1128, confirmLinkedIn1128, uncertainLinkedIn1128 } from '../../services/linkedin1128_submission.service';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';
export function registerLinkedIn1128SubmissionTools(server: McpServer) {
    const boundary = linkedin1128SubmissionSchema.shape;
    const attempted = { ...boundary, attemptId: z.number().int().positive() };
    server.registerTool('ba_start_linkedin_task1128_browser_submission', {
        description: 'Exact existing WI1924/task1128 company97416172 submission fence. Validates current owner/manifest/package/release/lease, creates one pending attempt. Never opens LinkedIn or sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: boundary
    }, async args => asToolResult(await startLinkedIn1128(args)));
    server.registerTool('ba_pre_submit_linkedin_task1128_browser_submission', {
        description: 'Rechecks exact company1128 package and active WI1924 lease immediately before owning Publisher Submit. Company evidence is Publisher browser readback, not server API verification.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: attempted
    }, async args => asToolResult(await preSubmitLinkedIn1128(args)));
    server.registerTool('ba_confirm_linkedin_task1128_browser_submission', {
        description: 'Atomically confirms the exact pending1128 attempt and canonical fact from verified company-author evidence plus public activity URL/object/time. Does not send.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: { ...attempted, publicUrl: z.string().url(), providerObjectId: z.string().regex(/^urn:li:activity:\d+$/),
            publishedAt: z.string().datetime({ offset: true }), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }
    }, async args => asToolResult(await confirmLinkedIn1128(args)));
    server.registerTool('ba_mark_linkedin_task1128_browser_submission_uncertain', {
        description: 'Freezes an ambiguous existing task1128 attempt for reconciliation only. No retry, new work item, release or provider operation.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: attempted
    }, async args => asToolResult(await uncertainLinkedIn1128(args)));
}
