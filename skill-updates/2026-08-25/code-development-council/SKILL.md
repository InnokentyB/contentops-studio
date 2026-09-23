---
name: code-development-council
description: Use for coding tasks that need structured product, UX, QA, architecture, security, test, or documentation review. Trigger when the user asks to adapt or use development agents, run a code council, design a development workflow, review implementation risk, or make non-trivial changes to an app, API, service, CI/CD, infrastructure, auth, payments, storage, or production deployment.
---

# Code Development Council

Use this skill to turn the Antigravity agent set into a lightweight Codex development workflow. The goal is better engineering judgment, not a meeting simulator.

## When To Apply

Apply explicitly for:

- User-facing product or UI changes.
- Backend API, auth, billing, storage, queues, webhooks, migrations, or deployment changes.
- New dependencies, framework changes, or cross-module refactors.
- CI failures, production bugs, regressions, or release preparation.
- Any request that mentions agents, council, architect, QA, security review, or development workflow.

For tiny edits, apply only the relevant lens and keep the user-facing output brief.

## Council Roles

### UI/UX Designer

Checks user goal, happy path, empty/error/loading states, accessibility, visual consistency, and whether existing components/patterns should be reused.

### UX Skeptic

Challenges whether the change is necessary, too complex, hard to recover from, confusing under stress, or likely to break with slow networks, no data, large data, or repeated actions.

### QA Analyst

Converts requirements into acceptance criteria and edge cases. Prefer Given/When/Then for important behavior. Include negative paths, permissions, quotas, retries, and partial failures.

### Tech Lead

Checks feasibility against the current stack. Prefer existing helpers, dependencies, conventions, and deployment patterns. Push back on unnecessary packages and over-engineering.

### System Architect

Checks boundaries, dependency direction, naming, module ownership, migrations, and whether abstractions are proportionate.

Before designing a specialized workflow or interface, identify the canonical durable entity and lifecycle. Specialized screens may project or filter that lifecycle, but must not create a second status model, write path, or operational reality.

### Security Officer

Checks untrusted input, auth/RBAC, secrets, logs, SQL/command injection, XSS, SSRF, path traversal, webhook signatures, payment integrity, and safe error messages.

For agent protocols, treat discovery as part of authorization. Bind credentials to a tenant and capability profile, build the visible tool catalog from an allowlist, enforce the same allowlist at dispatch, and expose non-secret binding metadata so readiness can be evaluated for the resource currently being viewed.

### QA Automation

Chooses and runs tests proportional to risk. Add or update focused tests when behavior changes. Broaden regression checks for shared code or production-critical paths.

For analytics changes, verify the two-sided event contract: the application emits the exact identifier after the intended success condition, and the production analytics destination has a matching goal/property/event definition.

For external AI providers, test the full wire contract rather than only the model name: endpoint, authentication placement, payload, response extraction, retired overrides, and a bounded live smoke when the path is production-critical. For cost claims, require invocation-level provider, model, usage, outcome, latency, chain correlation, and price-coverage evidence; distinguish measured, estimated, and unknown cost.

### Documentation Agent

Updates docs only when setup, env vars, public APIs, user-visible behavior, runbooks, or onboarding materially changed.

## Workflow

1. Read the repo shape first: package files, test setup, relevant modules, existing patterns.
2. Identify the minimum useful council lenses for the task.
3. For non-trivial work, write a short internal checklist:
   - Product/UX risk.
   - QA acceptance criteria.
   - Architecture/tech fit.
   - Security/data risk.
   - Verification plan.
   - Observable capability contract: promised side effect, persistence, and production destination.
4. Implement the smallest coherent change.
5. Verify with targeted tests first. Run broader checks when shared or risky behavior changed.
6. Commit only relevant files when asked. Avoid unrelated formatting churn.
7. Re-read the applicable hard stops and evidence gates against the actual results; do not rely on the plan as proof they ran.
8. In the final answer, report what changed, what passed, and any residual risk.

## Production evidence gates

Before declaring a production release complete:

1. If startup applies migrations, compare migration history with the live schema as separate facts. Inspect the live-to-target diff, classify destructive statements, and baseline only effects proven present.
2. Capture the intended commit identity and wait until every required service reports success for that exact commit.
3. Record a global dependency-health snapshot and run a capability-specific production probe tied to the changed behavior. Report unrelated degradation separately.
4. Do not expose an agent capability in production unless its real dependency path is executable; otherwise hide or explicitly disable it with a readiness reason.

## Verifiable agent handoffs

When reporting where or how another agent or operator should continue, include a verified canonical deep link or executable command, the observation timestamp, and the current persisted state. Label proposed navigation as proposed. Never present a designed route or remembered workflow state as a shipped UI fact.

During shaping and review, trace every critical operation to an observable side effect and persistence contract. Classify it as complete, shell-only, manually orchestrated, or absent. Tool, endpoint, and table names are not implementation evidence.

For paid digital delivery, add an adversarial production probe: request the final asset directly without session, order, token, or referrer and require `404` or `403`; then verify that a successful purchase creates a revocable opaque-token path and a refund invalidates it. Source-level entitlement checks do not prove that the underlying asset is protected.

## Hard Stops

Stop and resolve before commit/deploy if:

- A secret or production credential may be exposed.
- A new or changed endpoint/action lacks authorization.
- A migration or data operation lacks compatibility/rollback thinking.
- Payment/quota logic could double-charge, lose money, or miscount usage.
- A paid asset remains directly reachable outside the verified entitlement path.
- The change may delete user data or run destructive commands without explicit approval.
- Relevant tests fail.

## Output Style

Do not dump every role's monologue. Summarize only the decisions that changed the implementation:

- "Council check" for substantial tasks.
- "Risk found" when a role blocks or changes the plan.
- "Verification" with exact tests/commands that matter.
