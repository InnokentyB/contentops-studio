import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { release1086Schema, submission1086Schema } from '../../services/linkedin1086_contract';
import { controlLinkedIn1086 } from '../../services/linkedin1086_release';
import { lease1086Schema, leaseLinkedIn1086 } from '../../services/linkedin1086_lease';
import { startLinkedIn1086, preSubmitLinkedIn1086, confirmLinkedIn1086, uncertainLinkedIn1086 } from '../../services/linkedin1086_lifecycle';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';
async function control(run: () => Promise<Record<string, unknown>>) {
    try { return asToolResult(await run()); } catch (error: unknown) {
        const code = error instanceof Error ? /^\[([A-Z0-9_]+)\]/.exec(error.message)?.[1] : undefined;
        throw new Error(code && /^(LINKEDIN1086_[A-Z0-9_]+|OWNER_REQUIRED|STALE_MANIFEST|IDEMPOTENCY_CONFLICT)$/.test(code)
            ? `[${code}]` : '[LINKEDIN1086_CONTROL_FAILED] Reconcile same key; never resend');
    }
}
export function registerLinkedIn1086Tools(server: McpServer) {
    server.registerTool('ba_repair_linkedin_task1086_metadata', {
        description: 'Preview/apply exact1086 English/manual metadata only. Preserves accepted body, revision, decision, dates and channel; never releases or sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: release1086Schema.shape
    }, async a => control(() => controlLinkedIn1086(a, false)));
    server.registerTool('ba_release_linkedin_task1086_browser', {
        description: 'Preview default. Release exact accepted English1086 rev1 to personal LinkedIn profile only. Requires audited metadata repair and absent attempt/fact/work; creates one browser WI, never sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: release1086Schema.shape
    }, async a => control(() => controlLinkedIn1086(a, true)));
    for (const renew of [false, true]) server.registerTool(renew ? 'ba_renew_linkedin_task1086_browser_lease' : 'ba_claim_linkedin_task1086_browser', {
        description: 'Preview default; apply claims exact1086 WI or renews the same actor expired lease before any attempt. Renewal requires exact preview expiry/SHA. No provider send.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: lease1086Schema.shape
    }, async a => control(() => leaseLinkedIn1086(a, renew)));
    const boundary = submission1086Schema.shape; const attempted = { ...boundary, attemptId: z.number().int().positive() };
    server.registerTool('ba_start_linkedin_task1086_browser_submission', {
        description: 'Start exactly one accepted English1086 rev1 attempt on its claimed WI. Requires audited release and active lease. Any existing attempt means reconcile only. No UI/API execution.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: boundary
    }, async a => control(() => startLinkedIn1086(a)));
    server.registerTool('ba_pre_submit_linkedin_task1086_browser_submission', {
        description: 'One-shot Post permission for English1086 rev1 only. Requires fresh actual personal author/editor/duplicate readback and a reference to owner action-time confirmation. These are owning-Publisher reports, not server provider verification. Replay never permits a second click.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...attempted, actionTimeConfirmationReference: z.string().min(10), observedEditorText: z.string().min(1).max(10000) }
    }, async a => control(() => preSubmitLinkedIn1086(a)));
    for (const reconcile of [false, true]) server.registerTool(reconcile ? 'ba_reconcile_linkedin_task1086_browser_submission' : 'ba_confirm_linkedin_task1086_browser_submission', {
        description: `${reconcile ? 'Reconcile after expiry with the historical SAME actor/fence; audit as reconciliation.' : 'Normal confirmation requires the active lease; audit as confirmation.'} Record only the same1086 attempt from owning native post readback: exact English text, personal innokentyb, numeric object/permalink and matching actual time. No provider call, Submit or retry. Server does not claim independent provider verification.`,
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...attempted, actionTimeConfirmationReference: z.string().min(10),
            observedEditorText: z.string().min(1).max(10000),
            publicUrl: z.string().url(), providerObjectId: z.string().regex(/^urn:li:activity:\d+$/), publishedAt: z.string().datetime({ offset: true }),
            evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/), observedPostText: z.string().min(1).max(10000),
            observedAuthorProfileUrl: z.literal('https://www.linkedin.com/in/innokentyb/'), observedPublishedAt: z.string().datetime({ offset: true }) }
    }, async a => control(() => confirmLinkedIn1086(a, reconcile)));
    server.registerTool('ba_mark_linkedin_task1086_browser_submission_uncertain', {
        description: 'Freeze the same1086 attempt for reconciliation, including after lease expiry. Does not clear a fence, release work or grant another Submit.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: attempted
    }, async a => control(() => uncertainLinkedIn1086(a)));
}

