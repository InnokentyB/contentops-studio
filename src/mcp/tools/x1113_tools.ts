import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { x1113ReleaseSchema, x1113ClaimSchema, x1113BoundarySchema } from '../../services/x1113_contract';
import { releaseX1113, claimX1113 } from '../../services/x1113_release';
import { startX1113, preSubmitX1113, confirmX1113, uncertainX1113 } from '../../services/x1113_lifecycle';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';
async function control(run: () => Promise<Record<string, unknown>>) {
    try { return asToolResult(await run()); }
    catch (error: unknown) {
        const code = error instanceof Error ? /^\[([A-Z0-9_]+)\]/.exec(error.message)?.[1] : undefined;
        const safe = code && /^(X1113_[A-Z0-9_]+|OWNER_REQUIRED|STALE_MANIFEST|IDEMPOTENCY_CONFLICT)$/.test(code);
        throw new Error(safe ? `[${code}]` : '[X1113_CONTROL_FAILED] Reconcile the same command/key; never resend');
    }
}
export function registerX1113Tools(server: McpServer) {
    server.registerTool('ba_release_x_task1113_browser', {
        description: 'Exact owner release of accepted X1113 rev1/channel164, personal Innokenty profile only. Rebuilds manual English handoff, creates one WI, never sends or contacts provider.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: x1113ReleaseSchema.shape
    }, async a => control(() => releaseX1113(a)));
    server.registerTool('ba_claim_x_task1113_browser', {
        description: 'Claims only the sole released X1113 work for the owning actor. Requires actual fresh native personal context guard; server cannot verify browser context. Never submits.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: x1113ClaimSchema.shape
    }, async a => control(() => claimX1113(a)));
    const boundary = x1113BoundarySchema.shape;
    const attempted = { ...boundary, attemptId: z.number().int().positive() };
    server.registerTool('ba_start_x_task1113_browser_submission', {
        description: 'Fences one X1113 attempt after owning runtime checks actual native BrowserInfo/profile/account. Any existing attempt is reconciliation-only. No server browser or API send.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: boundary
    }, async a => control(() => startX1113(a)));
    server.registerTool('ba_pre_submit_x_task1113_browser_submission', {
        description: 'One-shot pre-submit control. Owning runtime must re-read native personal context/editor and run checkX1113LiveContext immediately before its one Post click. A server receipt alone is not browser proof. Replay never grants a second click.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: attempted
    }, async a => control(() => preSubmitX1113(a)));
    server.registerTool('ba_confirm_x_task1113_browser_submission', {
        description: 'Atomic confirmed X1113 attempt/fact from exact @naraHeTc numeric status ID, permalink, actual time and native evidence. Preserve the pre-submit context fields; confirmation does not require still-fresh observedAt. Never sends.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...attempted,
            publicUrl: z.string().url(), providerObjectId: z.string().regex(/^\d+$/),
            publishedAt: z.string().datetime({ offset: true }), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }
    }, async a => control(() => confirmX1113(a)));
    server.registerTool('ba_mark_x_task1113_browser_submission_uncertain', {
        description: 'Freeze an ambiguous sole X1113 attempt for reconciliation. Never resend or create another work/release/attempt.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: attempted
    }, async a => control(() => uncertainX1113(a)));
}
