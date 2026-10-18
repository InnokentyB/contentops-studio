# Actionable publication diagnostics: Threads pilot

## Approved boundary

Owner direction, 18 October 2026: begin with Threads, prove useful logging and actionable errors, then extend the pattern to other services and make it an agent development rule. This implements diagnostic behavior only. It does not authorize deployment, publication, provider sessions or changes to production history. Existing #1136/#1048 recovery approvals remain independent.

LOCK: an operator calling `ba_publish_threads_task` must see which exact owner-release checks failed and what supported correction is possible. Keep the legacy `THREADS_GENERIC_OWNER_RELEASE_REQUIRED` code. Missing release is one distinct reason; a present release reports all seven proof mismatches. These are eight total predicates, including existence.

QAR: deterministic reason ordering; no request/proof values, body, approval reference, token, cookie, provider payload or unnecessary identifiers in diagnostics/logs; no provider calls or claim mutations on rejection; existing successful dry-run/live/idempotency/uncertain behavior preserved. Unexpected errors explicitly say the cause is unclassified rather than inventing a cause.

ARCH: service guard throws `PublicationDiagnosticError`; shared diagnostic shape is independent of MCP. The Threads MCP handling boundary serializes safe fields to both text and structuredContent, marks isError, and emits one structured stderr warning. Existing Threads codes are mapped through a static remediation catalog; unknown errors are masked at this boundary. No full error object or arguments are logged. Authenticated identity/project scoping remains upstream. Responses are English, matching the existing tool surface.

RISK: keep all strict comparisons, scoped release lookup, idempotency and provider/claim ordering. No diagnostic reads outside the existing authorized lookup. Missing proof must fail closed. Recommendations must never bypass authorization, manually edit proof, switch a key to evade an attempt, or resend an uncertain publication. Raw errors are deliberately excluded even from logs. This pilot does not add a durable logging backend or alter immutable publication audit records.

## Operator example

```json
{
  "code": "THREADS_GENERIC_OWNER_RELEASE_REQUIRED",
  "message": "Publication is blocked because the audited owner release does not match the accepted package.",
  "reasons": [{
    "code": "ACCEPTED_REVISION_MISMATCH",
    "field": "accepted_revision",
    "message": "The accepted revision differs from the released revision.",
    "action": "Complete review of the current revision and obtain a release for that accepted revision."
  }],
  "retry_allowed": false
}
```

`retry_allowed: false` forbids automatic repetition of the rejected request; it does not permanently forbid a new, properly reviewed operation after the cause is corrected. UNKNOWN requires reconciliation first.

## Verification and operation

Run from the assigned worktree, never the canonical runtime checkout:

```sh
docker compose -f ops/threads-diagnostics/compose.yaml build checks
docker compose -f ops/threads-diagnostics/compose.yaml run --rm --no-deps checks
docker compose -f ops/threads-diagnostics/compose.yaml run --rm --no-deps checks node -e 'console.log("Build image ready; no app started")'
docker compose -f ops/threads-diagnostics/compose.yaml ps -a
docker compose -f ops/threads-diagnostics/compose.yaml logs --tail 100
docker compose -f ops/threads-diagnostics/compose.yaml down
```

The reviewed existing Dockerfile builds backend/Prisma and frontend. The context excludes dependencies, generated output, env files and Git. Compose uses a unique image/project, non-root user, no network, no ports, read-only source/filesystem, temporary logs, CPU/RAM/PID/log limits. All test dependencies are injected synthetic fixtures; no database is contacted. Synthetic DATABASE_URL points to an unavailable local port so an accidental real query fails closed. The synthetic Telegram token only satisfies an existing import-time constructor; it cannot contact a provider without a network.

For the quality gate in a detached/mapped worktree, mount **only its Git common metadata** read-only at its original absolute path, with `/workspace` as the safe Git directory; otherwise the preserved absolute `.git` pointer cannot resolve inside Docker. Never mount the Docker socket or host root into this job. Run `npm run quality:gate` in `/workspace` against the current source, not the source baked into an older image.

## Rollout and limits

The pilot covers the explicit Threads publication tool, including its generic release-proof validation and legacy publication fallback. Exact reasons cover the generic owner-release proof guard. Other existing Threads publication errors receive known-cause explanations and correction steps; the existing compound package guard is honestly identified as a readiness guard, with inspection steps rather than guessed individual failures. Canonical publication routing through other tools, release-creation tools, API/UI adapters and other providers are not yet converted. The generic release-creation tool retains its exact registration: changing its enclosing statement changes the fingerprint of an existing fixed-project schema finding. Its broader conversion needs a separate treatment of that baseline debt, not an exemption hidden in this diagnostic change.

After owner UAT of this pilot, inventory those boundaries and migrate in bounded slices: authorization/scope; accepted-package/review; provider readiness; concurrency/idempotency; UNKNOWN reconciliation. Each slice needs tests at the actual operator boundary, a static reason/remediation catalog, safe structured logging and unchanged guards. Do not bulk-rewrite errors or claim full project coverage based on a shared type alone.

New/changed code follows this rule immediately through AGENTS.md and .agents/AGENTS.md. Engineering evidence is separate from owner UAT. Production deploy and read-only verification of any existing task require their own explicit authorized context; never publish as a diagnostic check.
