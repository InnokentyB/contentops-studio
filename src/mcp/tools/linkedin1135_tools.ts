import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';
import { linkedin1135ReleaseSchema, linkedin1135ClaimSchema, linkedin1135BoundarySchema,
    linkedin1135PreSubmitSchema, linkedin1135ConfirmSchema, linkedin1135ReconcileSchema,
    linkedin1135UncertainSchema, linkedin1135DiagnoseSchema, releaseLinkedIn1135, claimLinkedIn1135,
    startLinkedIn1135, preSubmitLinkedIn1135, confirmLinkedIn1135, reconcileLinkedIn1135,
    markLinkedIn1135Uncertain, diagnoseLinkedIn1135 } from '../../services/linkedin1135_browser';

/** Exact package wrappers over the existing browser lifecycle; no browser/provider APIs are exposed. */
export function registerLinkedIn1135Tools(server: McpServer): void {
    server.registerTool('ba_release_linkedin_task1135_browser', {
        description: 'Owner-only exact p10/task1135/r2/company79633032/image163 release. Creates one revision-bound browser WI; does not publish. Preserves copy/date/image/history. Duplicate-check reference must say what was actually checked, not imply unperformed provider verification.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedin1135ReleaseSchema.shape
    }, async args => asToolResult(await releaseLinkedIn1135(args)));
    server.registerTool('ba_claim_linkedin_task1135_browser_publication', {
        description: 'Claim only the existing owner-released task1135 browser item; returns its normal fenced lease.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedin1135ClaimSchema.shape
    }, async args => asToolResult(await claimLinkedIn1135(args)));
    server.registerTool('ba_start_linkedin_task1135_browser_submission', {
        description: 'Durable attempt before any company composer/image mutation. Any previous attempt, including an aborted one, requires reconciliation; never resend.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedin1135BoundarySchema.shape
    }, async args => asToolResult(await startLinkedIn1135(args)));
    server.registerTool('ba_pre_submit_linkedin_task1135_browser_submission', {
        description: 'Immediately before Submit, validate observed company author, exact body and ordered paragraph hashes, exactly one attached image163/SHA and provider duplicate absence. Records evidence hash and lease fingerprint, never a raw token.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedin1135PreSubmitSchema.shape
    }, async args => asToolResult(await preSubmitLinkedIn1135(args)));
    server.registerTool('ba_confirm_linkedin_task1135_browser_submission', {
        description: 'Atomically record a fact/attempt/audit only after exact company post readback, original image, paragraph structure, canonical permalink/provider ID and prior pre-submit proof. Receipt or Submit click alone is not success.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedin1135ConfirmSchema.shape
    }, async args => asToolResult(await confirmLinkedIn1135(args)));
    server.registerTool('ba_reconcile_linkedin_task1135_browser_submission', {
        description: 'Owner-only readback confirmation of an existing task1135 attempt after UNKNOWN/expired lease. Requires actual company/text/image/paragraph/permalink evidence; never creates another attempt or resend authority.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedin1135ReconcileSchema.shape
    }, async args => asToolResult(await reconcileLinkedIn1135(args)));
    server.registerTool('ba_mark_linkedin_task1135_browser_submission_uncertain', {
        description: 'Freeze the existing attempt with a bounded reason and audit; no raw browser errors and no retry permission.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: linkedin1135UncertainSchema.shape
    }, async args => asToolResult(await markLinkedIn1135Uncertain(args)));
    server.registerTool('ba_diagnose_linkedin_task1135_browser', {
        description: 'Read-only exact package, ordered paragraph hashes, WI/attempt/fact IDs and next owning action. Never exposes lease tokens or provider credentials.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: linkedin1135DiagnoseSchema.shape
    }, async args => asToolResult(await diagnoseLinkedIn1135(args)));
}
