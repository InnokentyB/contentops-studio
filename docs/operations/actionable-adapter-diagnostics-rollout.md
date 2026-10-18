# Actionable diagnostics across publication adapters

## Authority and delivery boundary

On 18 October 2026 the owner reported a successful Threads publication and instructed engineering to extend the same diagnostic behavior to the remaining adapters, explicitly allowing parallel work. This continues the diagnostics rollout; it grants no publication, provider-session, scheduler or consumer activation. #1136/#1048 recovery gates remain independent.

LOCK: supported publication operations explain the observed failed prerequisite, corrective workflow and retry/reconciliation restriction through the operator's MCP or HTTP response. Known blocked/readback states remain legitimate successful reads. Unknown failures say that their exact cause is unclassified, without inventing a cause or echoing provider text.

QAR: no provider calls/retries introduced by diagnostics; unchanged successful publication and authorization behavior; no raw exception/body/approval/token/cookie/provider payload in diagnostic responses or logs. No new runtime-policy debt or baseline exemptions. Tests must exercise actual SDK MCP serialization and HTTP injection, not only catalog lookup.

ARCH: `publicationDiagnosticResult` handles the operator boundary; provider catalogs return reviewed static text and reason codes. A result projector distinguishes actual failure from an informational blocked state and removes unreviewed result fields. `PublicationDiagnosticError` transports safe diagnostics to HTTP without changing the large route registration. Small UI formatting logic lives outside the existing large screen component. The central publisher logger classifies old call-site templates and writes the same safe structured envelope to its file and console sinks.

RISK: preserve owner/tenant scope, registered independent Dzen/VK routes, exact package and lease fencing, one-attempt history and idempotency. Receipt or browser handoff never means provider success. UNKNOWN requires reconciliation; no advice to resend, replace the key or switch to a browser/API/manual fallback. Diagnostic data never grants execution authority. Protected VK execution-package responses retain authorized package fields while the attached diagnostic and log exclude their content and approval binding.

## Implemented coverage

| Surface | Coverage | Behavioral limit |
| --- | --- | --- |
| `ba_publish_direct` | Configured direct adapters, including Telegram, Reddit, LinkedIn, Threads and OK configuration errors; generic safe handling for remaining provider exceptions | Provider transports and eligibility stay unchanged. Arbitrary provider text is not parsed as a trusted cause. |
| `ba_publish_publication_task` | Telegram, Dzen and routed Threads task failures; accepted revision, asset, release, idempotency, schedule, claimed and uncertain outcomes | Existing dispatcher routing remains the authority. Historical numeric Dzen error namespaces are not added to production catalogs. |
| Shared browser lifecycle tools | Ten inspect/repair/release/claim/start/pre-submit/confirm/reconcile/uncertain/diagnose controls for LinkedIn, DEV.to, Setka and X | Browser execution is not performed by the MCP handler. All observed safe snapshot fields are reported, including asset/decision bindings. |
| X native MCP | Five scoped state/pairing/registration/revocation/challenge controls | Disabled registrations remain disabled; no extension enrollment or live execution is activated. |
| VK connector MCP | Thrown guard failures, job blockers, offline/disabled health, uncertainty and denied/not-checked package admission | Valid state observations keep `isError: false`; content is returned only through the existing protected package reader. No provider readiness is inferred. |
| HTTP task publish-now | Safe typed exceptions plus returned browser handoff/denial through the Publisher facade | HTTP status and successful control-operation semantics are preserved. Existing HTTP `error` string now includes safe cause and corrective steps. |
| Publication Tasks screen | Shows returned cause and action; no false “publication started” message for a blocked task or handoff | Unknown legacy responses instruct state/fact inspection instead of claiming success. |
| Central publisher logger | Existing dispatcher, Telegram and legacy publisher call sites through `logToFile` | Static outcomes distinguish started/reported-success/waiting/fact verification; no raw message or data reaches either sink. |
| Persisted connector failure handoff reason | Safe explanation/action replaces the raw exception message | Existing top-level code, route marker and no-API-retry flags remain unchanged; no new browser authority. |

Known Telegram success traces keep reviewed routing context, but raw fallback errors, session hints and potentially signed asset URLs are removed from the MCP representation. Failed diagnostics contain no destination or session identifiers. Structured logger output does not include either success or failure response payloads.

## Explicit remaining debt

- Old task-specific LinkedIn/Threads/Dzen/VK/Setka release and recovery namespaces imported by `release_control_tools.ts` are not all rewritten. This change targets reusable adapter paths; it does not add more task-specific catalogs or bypass existing debt fingerprints.
- Compound legacy readiness/fence errors explain the established aggregate failure and its inspection path; exact subconditions are reported only where observed.
- Raw platform services called outside these operator/central-log boundaries, other API routes, legacy ongoing-rule internals and historical persisted records are not claimed fully converted. No historical audit or recovery record is rewritten.
- Valid protected readback payloads still contain the data needed by their authorized consumer. Secret-free diagnostics must not be confused with deleting required content from an execution package.

These are recorded limits, not exemptions for new code. New/changed boundaries continue to follow AGENTS.md. Further conversion should proceed through shared mechanisms with tests and reviewed scope, rather than business-ID production branches.

## Operator acceptance without publication

From the assigned worktree:

```sh
docker compose -f ops/publication-diagnostics/compose.yaml build checks
docker compose -f ops/publication-diagnostics/compose.yaml run --rm --no-deps checks
docker compose -f ops/publication-diagnostics/compose.yaml ps -a
docker compose -f ops/publication-diagnostics/compose.yaml logs --tail 100
docker compose -f ops/publication-diagnostics/compose.yaml down
```

All test databases/providers are injected synthetic fixtures, network is disabled and no real provider credential is supplied. The reviewed image compiles backend/Prisma and frontend; the compiler has an explicit 1536 MiB heap after the default heap exhausted in preliminary checks. Runtime resource/log limits, read-only source, non-root user, temporary logs and automatic one-off cleanup are inherited from the checked Compose configuration. Live applications are not started. One-off output is captured in the run log because removed containers do not retain Compose logs.

The quality gate uses a read-only mount of this worktree's Git common metadata, as documented for the Threads pilot, so preserved absolute `.git` pointers resolve. No Docker socket or host root is mounted into application/test jobs.

Owner UAT should confirm that each demonstrated reason points to a supported correction, no uncertain result recommends resend, and the screen differentiates a blocked operation from a successful state read or publication report. Provider readiness and live publication remain separate acceptance steps.
