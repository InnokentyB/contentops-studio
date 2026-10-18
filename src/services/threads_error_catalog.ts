import { PublicationDiagnosticError, type PublicationDiagnostic } from './publication_diagnostics';

// Static text only. Never interpolate error messages, proof values, IDs or provider responses.
const catalog: Record<string, readonly [string, string, string]> = {
    THREADS_OWNER_REQUIRED: ['actor', 'This operation requires a project owner.', 'Ask a project owner to execute the operation using their authenticated identity.'],
    PROJECT_OWNER_REQUIRED: ['actor', 'This operation requires a project owner.', 'Ask a project owner to execute the operation using their authenticated identity.'],
    MCP_PROJECT_SCOPE_MISMATCH: ['manifest', 'The workspace scope or manifest is not current.', 'Read the authenticated workspace manifest and verify the intended project before requesting owner approval.'],
    THREADS_TASK_MISMATCH: ['task', 'No Threads task is available in the authorized scope.', 'Check the task and channel in the current project. Do not broaden project permissions to bypass this check.'],
    THREADS_TASK_SCOPE_MISMATCH: ['task', 'The task does not match the authorized publication scope.', 'Verify the selected project, channel and task using read-only inspection.'],
    THREADS_TASK_NOT_CANONICAL: ['publication_package', 'The task does not satisfy the canonical publication contract.', 'Read the current accepted text, visual decision, revision, handoff and release status; repair the unmet prerequisites through their normal review workflows.'],
    THREADS_GENERIC_PACKAGE_GUARD_FAILED: ['publication_package', 'The current publication package failed its readiness guard.', 'Inspect accepted/content revisions, text length, visual decision, handoff, publication mode, holds and existing attempts/facts. Resolve the unmet prerequisite through its normal lifecycle; reconcile an existing or uncertain attempt before any resend.'],
    THREADS_CONNECTOR_NOT_READY: ['connector', 'The Threads connector lacks required configuration.', 'Ask the connector administrator to configure the account and credential through the supported secure setup; never paste credentials into a publication request.'],
    THREADS_PROVIDER_IDENTITY_UNVERIFIED: ['provider_identity', 'The provider account could not be verified against the approved identity.', 'Ask the connector administrator to verify the configured account and connection. Obtain a new release if the intended account changes.'],
    THREADS_DUPLICATE_FOUND: ['provider_history', 'An identical post was found in provider history.', 'Inspect the existing post and reconcile its publication fact. Do not send a duplicate.'],
    THREADS_HISTORY_INCOMPLETE: ['provider_history', 'The bounded duplicate check could not establish complete history.', 'Ask the connector administrator to investigate history pagination or access. Complete duplicate verification before any send.'],
    THREADS_GENERIC_EXPECTATION_MISMATCH: ['publication_package', 'The requested package differs from the current accepted package.', 'Read the current channel, revision, text digest, schedule, visual state and account identity; review changes and request owner approval for the exact current package.'],
    THREADS_GENERIC_CAS_CONFLICT: ['publication_package', 'The package changed while the operation was being prepared.', 'Read the latest task and release history. Review changes before issuing a fresh approved operation; do not replay stale inputs.'],
    IDEMPOTENCY_CONFLICT: ['idempotency_key', 'This key is already bound to a different request.', 'Read the original operation result. Reuse its exact inputs to inspect/replay a confirmed result; do not create a new key to bypass an existing publication attempt.'],
    IDEMPOTENCY_KEY_REQUIRED: ['idempotency_key', 'Publication requires an idempotency key.', 'Supply a stable key for the approved operation and preserve it for any subsequent reconciliation.'],
    THREADS_NOT_DUE: ['schedule', 'The approved publication time has not arrived.', 'Wait until the approved time. If the schedule must change, use the normal review and release workflow.'],
    THREADS_PUBLICATION_ALREADY_CLAIMED: ['delivery_attempt', 'Another execution has already claimed publication.', 'Read the existing attempt and reconcile its outcome. Do not create another attempt or send again.'],
    THREADS_PUBLICATION_UNCERTAIN: ['delivery_attempt', 'The provider outcome is uncertain.', 'Reconcile the existing attempt against provider history and record the verified outcome. Do not resend or replace the idempotency key.'],
    THREADS_GENERIC_PACKAGE_CHANGED: ['publication_package', 'The accepted package changed before confirmation.', 'Reconcile the existing attempt and provider outcome, then review the package change. Do not send again.'],
    THREADS_ATTEMPT_CONFLICT: ['delivery_attempt', 'The attempt changed before confirmation could be recorded.', 'Read and reconcile the existing attempt and publication fact; do not dispatch again.'],
    THREADS_DISPATCH_GUARD_FAILED: ['publication_package', 'The package or connector changed before dispatch.', 'Inspect the existing attempt and current package/account configuration. Reconcile its state before any further execution.'],
    THREADS_OWNER_RELEASE_PROOF_MISMATCH: ['release', 'The owner release does not match the current package.', 'Read the audited release and accepted package. Ask the owner to resolve the mismatched binding through the supported release workflow.'],
    THREADS_REQUEST_FAILED: ['operation', 'The operation could not complete; its exact cause is not classified.', 'Ask engineering to investigate the failed operation using safe diagnostics. Inspect attempt and fact history first; reconcile any uncertain outcome before another publication request.']
};

/** Maps only allowlisted codes to static explanations. Unknown errors disclose no raw text and forbid blind retry. */
export function threadsErrorDiagnostic(error: unknown): PublicationDiagnostic {
    if (error instanceof PublicationDiagnosticError) return error.diagnostics;
    const candidate = error instanceof Error ? /^\[([A-Z_]+)\]/.exec(error.message)?.[1] : undefined;
    const code = candidate && Object.prototype.hasOwnProperty.call(catalog, candidate) ? candidate : 'THREADS_REQUEST_FAILED';
    const [field, message, action] = catalog[code]!;
    return { code, message, reasons: [{ code, field, message, action }], retry_allowed: false };
}
