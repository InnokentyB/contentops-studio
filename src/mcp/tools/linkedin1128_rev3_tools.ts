import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rev3ReleaseSchema, linkedin1128Rev3SubmissionSchema } from '../../services/linkedin1128_rev3_contract';
import { releaseLinkedIn1128Rev3 } from '../../services/linkedin1128_rev3_release';
import { rev3LeaseSchema, leaseLinkedIn1128Rev3 } from '../../services/linkedin1128_rev3_lease';
import { startLinkedIn1128Rev3, preSubmitLinkedIn1128Rev3, confirmLinkedIn1128Rev3, uncertainLinkedIn1128Rev3 } from '../../services/linkedin1128_rev3_lifecycle';
import { asToolResult, INTERNAL_MUTATION_ANNOTATIONS } from './common';
async function control(run: () => Promise<Record<string, unknown>>) {
    try { return asToolResult(await run()); } catch (error: unknown) {
        const code = error instanceof Error ? /^\[([A-Z0-9_]+)\]/.exec(error.message)?.[1] : undefined;
        throw new Error(code && /^(LINKEDIN1128_REV3_[A-Z0-9_]+|OWNER_REQUIRED|STALE_MANIFEST|IDEMPOTENCY_CONFLICT)$/.test(code)
            ? `[${code}]` : '[LINKEDIN1128_REV3_CONTROL_FAILED] Reconcile same key; never resend');
    }
}
export function registerLinkedIn1128Rev3Tools(server: McpServer) {
    server.registerTool('ba_release_linkedin_task1128_rev3_browser', {
        description: 'Preview default. Exact English1128 rev3 only: atomically supersede old pre-provider attempt38/WI1924 (reject any Submit/uncertain evidence), audit old binding provenance, rebind current task to company97416172 and release one new r3 WI. Preserves body/date/channel/decisions. No provider send.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: rev3ReleaseSchema.shape
    }, async a => control(() => releaseLinkedIn1128Rev3(a)));
    for (const renew of [false, true]) server.registerTool(renew ? 'ba_renew_linkedin_task1128_rev3_browser_lease' : 'ba_claim_linkedin_task1128_rev3_browser', {
        description: 'Preview default; apply true claims the new r3 WI or renews an expired same-actor lease only before any r3 attempt/event. Renewal requires exact preview expiry/SHA. New token is private; no Submit authority. Never claim old WI1924.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: rev3LeaseSchema.shape
    }, async a => control(() => leaseLinkedIn1128Rev3(a, renew)));
    const boundary = linkedin1128Rev3SubmissionSchema.shape; const attempted = { ...boundary, attemptId: z.number().int().positive() };
    server.registerTool('ba_start_linkedin_task1128_rev3_browser_submission', {
        description: 'Start exactly one English r3 attempt on its new claimed WI. Requires audited replacement/release and active lease. Any existing r3 attempt means reconcile only; superseded38 cannot be sent. No UI/API execution.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: boundary
    }, async a => control(() => startLinkedIn1128Rev3(a)));
    server.registerTool('ba_pre_submit_linkedin_task1128_rev3_browser_submission', {
        description: 'One-shot Post permission for English r3 only. Requires fresh actual company/editor/duplicate readback and a reference to owner action-time confirmation. These are owning-Publisher reports, not server provider verification. Replay never permits a second click.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...attempted, actionTimeConfirmationReference: z.string().min(10), observedEditorText: z.string().min(1).max(10000) }
    }, async a => control(() => preSubmitLinkedIn1128Rev3(a)));
    for (const reconcile of [false, true]) server.registerTool(reconcile ? 'ba_reconcile_linkedin_task1128_rev3_browser_submission' : 'ba_confirm_linkedin_task1128_rev3_browser_submission', {
        description: `${reconcile ? 'Reconcile after expiry with the historical SAME actor/fence; audit as reconciliation.' : 'Normal confirmation requires the active lease; audit as confirmation.'} Record only the same r3 attempt from owning native post readback: exact English text, company97416172, numeric object/permalink and matching actual time. No provider call, Submit or retry. Server does not claim independent provider verification.`,
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: { ...attempted, actionTimeConfirmationReference: z.string().min(10),
            observedEditorText: z.string().min(1).max(10000),
            publicUrl: z.string().url(), providerObjectId: z.string().regex(/^urn:li:activity:\d+$/), publishedAt: z.string().datetime({ offset: true }),
            evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/), observedPostText: z.string().min(1).max(10000),
            observedAuthorCompanyId: z.literal('97416172'), observedPublishedAt: z.string().datetime({ offset: true }) }
    }, async a => control(() => confirmLinkedIn1128Rev3(a, reconcile)));
    server.registerTool('ba_mark_linkedin_task1128_rev3_browser_submission_uncertain', {
        description: 'Freeze the same r3 attempt for reconciliation, including after lease expiry. Does not clear a fence, release work or grant another Submit.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: attempted
    }, async a => control(() => uncertainLinkedIn1128Rev3(a)));
}
