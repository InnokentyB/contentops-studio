# Engineering agent contract

All code changes follow `/Users/innokentyb/Documents/Product/PM/PORTFOLIO_CODE_QUALITY_TDPD_STANDARD.md`.

- Read `.agents/AGENTS.md` and the portfolio standard above before changing code. The former `.agents/rules/code-quality-defaults.md` path is absent; do not silently assume its contents.
- For behavior changes, define the operator boundary and write the failing acceptance test first.
- Preserve authorization, tenant isolation, audit history, publication gates, and idempotency.
- Never persist or log raw tokens, cookies, authorization headers, or provider payload secrets.
- Run `npm run quality:gate`, the focused test, and the relevant build before handoff.
- Engineering completion is not acceptance: owner UAT remains explicit.
- Existing debt is baselined; changed code must introduce no new `any`, silent catches, oversized modules, or weaker controls.

## Reusable production behavior — no publication-specific code

- A new ordinary publication must be executable as data through shared provider
  adapters and publication/review/recovery lifecycle contracts, without new
  production code or a deploy for its business identifiers.
- Do not create production functions, exports, modules, routes/endpoints,
  MCP commands, schema literals, capabilities or dispatch/allowlist branches for
  individual task IDs, actors, accounts, channels, revisions or release packages.
  Pass their IDs, hashes, dates and approval bindings as validated data; resolve
  the current tenant-owned records and capabilities at the execution boundary.
- Keep owner authorization, tenant isolation, exact accepted revision/manifest,
  asset identity, idempotency, audit and UNKNOWN/reconciliation controls. Replace
  task-specific checks with data-driven checks, never delete or bypass them.
- An actual provider/protocol limitation may require shared provider code. A
  new business task/account or an unimplemented generic lifecycle is not such a
  limitation; document the missing shared mechanism rather than adding an exact
  task implementation or a synthetic admission prerequisite.
- Numeric protocol constants, limits, dimensions and version formats are valid.
  Fixtures, isolated test scenarios, seeds, historical migrations and immutable
  audit/recovery records may name concrete business IDs. They must not be
  imported or promoted into executable task-specific production authority.
- Existing debt is not permission to copy it. Any temporary exception needs an
  exact, reviewable scope, reason, owner and removal plan. No blanket file,
  provider or security-check exemption is acceptable.

## Actionable errors and safe logging

- New or changed service boundaries must return a stable machine code, a plain-language explanation, concrete remediation steps and explicit retry/reconciliation guidance. A generic code alone is insufficient.
- Report every independently observable failed guard in a stable order. A missing prerequisite produces its own reason, not invented downstream mismatches. Never claim an exact cause when it was not established.
- Carry safe structured diagnostics through the actual API/MCP/UI serialization boundary, not only server logs. Preserve existing top-level codes where compatibility requires them.
- Log structured, allowlisted diagnostic data at the handling boundary. Never log raw exceptions/provider payloads, request arguments, approval references, tokens, cookies, authorization headers, bodies or unnecessary identifiers. Do not duplicate logs across layers.
- Remediation must preserve authorization, tenant scope, accepted-package bindings, audit, idempotency and publication gates. UNKNOWN/started/uncertain outcomes require reconciliation, never blind resend or a fresh key to bypass an attempt.
- Test each guard, multiple failures, missing/malformed prerequisites, the positive path, absence of provider calls/mutations on denial, actual operator serialization, and secret-free responses/logs. Unknown failures must have a safe explanation and an investigation path without pretending their cause is known.
- Reference implementation and staged rollout: `docs/operations/actionable-publication-diagnostics.md`. Extend service by service after the Threads pilot; never claim unconverted services comply.
- Current adapter coverage, safe publisher logging and remaining historical paths are recorded in `docs/operations/actionable-adapter-diagnostics-rollout.md`. Preserve successful status-read semantics; a handoff or receipt must never be displayed as confirmed publication.

## TDPD 0.13

Read `.tdpd/core/FRAMEWORK.md` and `.tdpd/core/QUICKSTART.md` before product work.
Shape/Plan/Audit do not authorize implementation or live publication.
Approve LOCK (goal/specification), QAR (measurable non-functional requirements), ARCH (architecture) and RISK (security/adversarial review) with the human before scenarios.
Keep TRUN scenario-level results and errors for each build; GREEN requires explicit owner UAT.
Pre-sync local work is preserved in `backup/contentops-pre-sync-20261010` (stash snapshot). Reconcile individual packages before restoring them; never overwrite current provider implementations with older local versions.

## Mandatory Dzen and VK operating route

Read `docs/operations/vk-owned-publication-route.md` before any governed VK work.
Dzen and VK owned-publication execution, control and read-only preflight use only documented
Planner commands -> registered independent adapter/consumer. No Codex role uses
CUA/cua.getTab/ComputerUse, personal tabs, CDP or session injection for Dzen or VK, including
login checks, diagnostics or UAT. Failed/not-ready adapter -> BLOCKED + repair;
never a Codex-browser, API, worker or other-chat fallback. Existing explicit
action/site denials remain applicable. UNKNOWN/started/uncertain -> reconciliation
only, no resend. No Codex manual fallback. Human operator handoff is a separate operating context and cannot bypass denial. Preserve
publication/task/job/release/lease/attempt/fact history. Receipt is not success.
