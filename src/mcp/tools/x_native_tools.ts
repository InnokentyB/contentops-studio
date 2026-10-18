import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { browserBoundarySchema } from '../../services/browser_publication_guard';
import { nativeRegistrationSchema, nativeScopeSchema, registerNativeInstallation, revokeNativeInstallation } from '../../services/x_native_registry';
import { nativePairingIssueSchema, issueNativePairing } from '../../services/x_native_pairing';
import { issueNativeChallenge } from '../../services/x_native_control';
import { nativeBundleSchema } from '../../services/x_native_receipt';
import { getXNativeState } from '../../services/x_native_diagnostics';
import { nativeStateRequestSchema } from '../../services/x_native_diagnostics_contract';
import { INTERNAL_MUTATION_ANNOTATIONS } from './common';
import { publicationDiagnosticResult } from './publication_diagnostic_result';
import { xNativeErrorDiagnostic } from '../../services/x_native_actionable_diagnostics';

/** Only scoped owner/Publisher controls belong here. Signed executor mutations are HTTP-only. */
export function registerXNativeTools(server: McpServer, enabled = process.env.X_NATIVE_PILOT_ENABLED === 'true'): void {
    if (!enabled) return;
    server.registerTool('ba_get_x_native_state', {
        description: 'Owner/Publisher scoped read-only X installation/audit inventory and exact-task delivery predicates. Capped unknown-safe snapshot; no secrets, registration authority, mutation, provider call or send.',
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: nativeStateRequestSchema
    }, async args => publicationDiagnosticResult('browser', () => getXNativeState(args), error => ({
        ...xNativeErrorDiagnostic(error), mutatesState: false, providerCalled: false
    })));
    const safe = (run: () => Promise<Record<string, unknown>>) =>
        publicationDiagnosticResult('browser', run, xNativeErrorDiagnostic);
    server.registerTool('ba_issue_x_native_pairing', {
        description: 'Owner-only issue of a short-lived one-shot pairing challenge for a canonical tenant-owned X package and public extension key. No claim, provider action or publication authority.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: nativePairingIssueSchema.shape
    }, async args => safe(() => issueNativePairing(args)));
    server.registerTool('ba_register_x_native_installation', {
        description: 'Owner preview/apply of a channel-scoped extension enrollment. Apply requires signed unused pairing plus explicit owner no-send UAT reference. Public key only; never enables publication or changes release.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: nativeRegistrationSchema.shape
    }, async args => safe(() => registerNativeInstallation(args)));
    server.registerTool('ba_revoke_x_native_installation', {
        description: 'Owner-only sticky revocation of a channel-scoped paired extension installation. Stops permits; preserves attempts/facts/audit and requires reconciliation of in-flight work.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS,
        inputSchema: nativeScopeSchema.extend({ reference: z.string().trim().min(10).max(500) }).shape
    }, async args => safe(() => revokeNativeInstallation(args)));
    const issue = browserBoundarySchema.safeExtend({ installationId: z.string().regex(/^[a-f0-9]{64}$/), bundleSha256: nativeBundleSchema,
        phase: z.enum(['start', 'permit', 'result', 'reconcile']), attemptId: z.number().int().positive().nullable() });
    server.registerTool('ba_issue_x_native_challenge', {
        description: 'Owner-bound challenge for an already released/claimed canonical X package. Never returns a lease or click authority. Signed HTTP receipt must consume the nonce atomically with the shared lifecycle mutation.',
        annotations: INTERNAL_MUTATION_ANNOTATIONS, inputSchema: issue.shape
    }, async args => safe(() => {
        const { installationId, bundleSha256, phase, attemptId, ...boundary } = issue.parse(args);
        return issueNativeChallenge({ context: browserBoundarySchema.parse(boundary), installationId, bundleSha256, phase, attemptId });
    }));
}
