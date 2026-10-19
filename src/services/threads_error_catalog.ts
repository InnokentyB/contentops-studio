import { PublicationDiagnosticError, type PublicationDiagnostic } from './publication_diagnostics';

// Static text only. Never interpolate error messages, proof values, IDs or provider responses.
const catalog: Record<string, readonly [string, string, string]> = {
    PUBLICATION_VISUAL_REVIEW_REQUIRED: ['visual_review','The current Owner visual requirement has no matching approved independent review.','Read the current art-direction context, complete its source/generation and separate visual review, then obtain a release for that exact package. Restoring old no-visual fields does not satisfy the requirement.'],
    THREADS_ATTEMPT_PERSISTENCE_UNAVAILABLE: ['database','Planner could not save the uncertain attempt outcome.','Restore database access, then inspect the original attempt through supported reconciliation. The post ID may not have been saved; never resend.'],
    THREADS_RECOVERY_PACKAGE_CHANGED: ['publication_package','The current schedule, visual decision or other package fields differ from the original owner release.','Inspect the original attempt and changed package through the owner review lifecycle. Do not publish again or force a fact onto a different package.'],
    THREADS_FACT_COMMIT_PENDING: ['delivery_attempt','The provider result was observed but Planner confirmation has not committed.','Run ba_reconcile_threads_publication for the existing attempt after database recovery. Never resend.'],
    THREADS_READBACK_PENDING: ['delivery_attempt','The saved provider object is awaiting confirmation.','Read or reconcile the existing attempt within its remaining lookup budget. Never resend.'],
    THREADS_RECOVERY_CAPABILITY_UNAVAILABLE: ['recovery','This attempt has no admitted Threads API recovery capability.','Ask engineering to verify the versioned API lifecycle and supported reader configuration. Do not reset or resend the attempt.'],
    THREADS_RECOVERY_IDENTITY_UNAVAILABLE: ['provider_identity','No trustworthy original published post identity was saved.','Keep this attempt frozen. Ask engineering to establish supported original-attempt correlation; a matching history post alone is insufficient.'],
    THREADS_RECOVERY_ACCOUNT_MISMATCH: ['provider_identity','The connected account differs from the original account.','Restore the original account connection through secure connector setup; never resend or change accounts to bypass recovery.'],
    THREADS_RECOVERY_READBACK_MISMATCH: ['provider_identity','The saved provider object does not satisfy the exact original publication identity.','Inspect protected attempt evidence and the original accepted package. Keep the attempt frozen; never overwrite a fact or resend.'],
    THREADS_RECOVERY_LOOKUP_INCOMPLETE: ['provider_history','Provider readback could not establish the existing delivery outcome.','Retry only the supported read-only reconciliation within the remaining budget after service recovery. Do not publish again.'],
    THREADS_RECOVERY_IN_PROGRESS: ['recovery','Another bounded readback is running for this attempt.','Wait for the existing recovery lease and read its result; do not start a new publication.'],
    THREADS_RECOVERY_BACKOFF: ['recovery','The next readback time has not arrived.','Wait for the persisted backoff before reconciling the same attempt; never change the idempotency key or resend.'],
    THREADS_RECOVERY_BUDGET_EXHAUSTED: ['recovery','The durable lookup budget is exhausted.','Ask engineering to investigate the protected provider evidence; this attempt remains frozen and cannot be resent.'],
    THREADS_RECOVERY_CONFLICT: ['recovery','The attempt, package, release or recovery lease conflicts with the observed result.','Read canonical task/attempt/fact history and resolve the conflicting authority through supported review. Never resend.'],
    THREADS_RECOVERY_INTERRUPTED: ['recovery','The bounded readback was interrupted before confirmation.','Inspect or resume reconciliation of this same attempt within its remaining durable budget. Never resend.'],
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
