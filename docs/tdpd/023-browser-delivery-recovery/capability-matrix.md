# Recovery capability admission baseline

Status: source inspection only, 2026-10-18. No provider readiness, permission, enrollment or live verification is asserted. Approval provenance and delivery scope: design.md approval record. A registered tool name is not evidence of an admitted generic recovery reader. Diagnostics describe the gap; they never create publication authority.

| Provider / surface | Implemented source capability | Missing / admission limit | Automatic v2 behavior currently supportable |
|---|---|---|---|
| Shared browser lifecycle | Known-object confirmation in `src/services/browser_publication_confirmation.ts`; accepted-package and lease guards in `browser_publication_execution.ts`; existing diagnose | No shared registered search reader; no demonstrated generic no-dispatch executor fence | Disabled assessment only until reader/fencing/all-writer checks are admitted |
| X native | `extensions/x-native/pilot-native.js` profile readback; `pilot-background.mjs` signed same-journal reconciliation; `src/services/x_native_execution.ts`, `x_native_advance.ts` | Signature proves executor provenance, not independently complete provider truth; shared cumulative budget, exact account/time/package matching and resume integration require proof; live installation unverified | Synthetic admitted ports only; no inferred live activation or old-journal replay |
| LinkedIn | Shared lifecycle accepts owning-Publisher known-object observations; `src/services/linkedin.service.ts` has bounded latest-post listing | Listing latest 20 posts and legacy exact-incident recovery are not admitted authoritative generic lookup or technical executor fencing | READBACK_CAPABILITY_UNAVAILABLE for generic automatic recovery; no alternate API/chat fallback |
| DEV.to / Setka | Known-object owner/executor readback through shared browser lifecycle | No generic registered authoritative inventory/search or enforceable quiescence proof found | Explicit capability gap; existing conservative workflow remains |
| VK connector metadata | `src/mcp/tools/vk_connector_tools.ts`; `vk_connector_dispatch.service.ts:279` projects existing DB fact/attempt; health/status reads | Schemas remain pilot project/task bindings. Mutation tools register only with `VK_CONNECTOR_DISPATCH_ENABLED=1`. DB reconciliation cannot discover provider objects | DB status observation only; no inference of provider absence/readiness |
| VK evidence reconciliation | `vk_connector_execution.service.ts:150` consumes app-authority verified wall evidence; `vk_connector_reconciliation.ts` pure exact-match/absence/UNKNOWN evaluator | Registered host/job/generation/package and trusted evidence required; pure evaluator is not a registered collector. Exact match records fact; nonmatch is not resend authority | No generic automatic provider lookup; synthetic registered evidence port only until admitted |
| VK owning operator collector | `vk1048_operator_reconcile.ts`, `vk1048_operator_dispatch.ts:38`, `vk1048_playwright_runtime.ts`; consumer `--operator-reconcile` in `src/workers/vk_connector_consumer.ts` | Explicit human-owned same frozen pilot job only. Managed polling never supplies provider dispatch by default; route/action denials remain binding | Never automatically invoke pilot collector from shared recovery; missing generic reader remains engineering work |
| Dzen1002 retained receipt | `src/mcp/tools/tomorrow_publication_tools.ts:51`; `src/services/dzen1002_runtime.ts:63`; `dzen1002_runtime_store.ts` | Exact original attempt, current authorization/fact guards and retained verified receipt. Missing receipt stays frozen; no provider discovery/session probe | Receipt-only completion is not generic readback lookup |
| Dzen1002 inventory | `dzen_task1002_route.service.ts:59`; `dzen1002_action_restriction.ts:12` | `requireDzen1002Action('inventory')` rejects unresolved action applicability before provider work; no design approval clears denial | Unavailable; no probe to test around restriction |
| Dzen1036/1045 historical recovery | Exact tools in `oct08_exact_release_tools.ts`, `oct10_owner_recovery_tools.ts`; task/phase services under `src/services/dzen_task1045*` | Incident-specific package/task/phase contracts and legacy transports; not shared automatic admission | Do not import/promote historical identifiers or transport into generic recovery |
| Dzen shared public/inbound readers | `src/mcp/tools/dzen_inbound_tools.ts`; `src/services/dzen_engagement.service.ts`; local coverage via `getRadarCoverage` | Bounded post/thread/reply reads; not complete owned-publication inventory or proof of attempted package identity/absence. Local coverage is not live session verification. Registration does not establish independent owned-publication route admission | Cannot substitute for missing admitted owned-publication recovery reader |

## Admission evidence required for any new provider port

Record the owning registered independent adapter, exact permitted read scope, supported evidence schema, tenant/account/package/time matching, collection/pagination/completeness and consistency semantics, request accounting/cancellation, durable operation budget, and current route/denial status. Read-only collection and same-attempt preparation resume are separate capabilities; neither implies send permission. A missing reader never selects an alternate browser, personal session, API, worker or chat.

For resume, additionally prove enforceable old-executor quiescence, absence of every issued permit and dispatch boundary, challenge supersession, generation/lease fencing across every writer, and atomic unchanged release/package revalidation. DB token rotation alone is insufficient. PROVEN_NOT_SENT never authorizes a new send in this slice.

## Synthetic PostgreSQL recommendation

Existing reviewed files: `ops/publication-tests/compose.yaml`, `ops/publication-tests/README.md`, `tests/tdpd/shared-browser-postgres.test.cjs` and `tests/tdpd/shared-browser.fixture.cjs`. Compose provides PostgreSQL16 on an internal project network, tmpfs fixture data, no host ports, non-root users and resource/log limits. The test asserts the synthetic URL and supports `SHARED_BROWSER_DIST` for the compiled source under test. It already exercises the real canonical fact writer, concurrent lifecycle calls and rollback injection.

Documented commands (not executed by this documentation task):

```sh
docker compose -f ops/quality/compose.yaml --profile build build build-check
docker compose -f ops/publication-tests/compose.yaml up -d synthetic-db
docker compose -f ops/publication-tests/compose.yaml run --rm tests node node_modules/prisma/build/index.js db push
docker compose -f ops/publication-tests/compose.yaml run --rm tests
docker compose -f ops/publication-tests/compose.yaml ps
docker compose -f ops/publication-tests/compose.yaml logs --tail 50 synthetic-db
docker compose -f ops/publication-tests/compose.yaml down
```

`db push` proves schema/application compatibility only, not migration SQL readiness. For S25, use a separate fresh synthetic stack lifecycle with pre-v2 schema and seeded existing rows, apply the additive migration, then assert retention and database constraints. A complete fresh `prisma migrate deploy` is a separate historical-chain test: legacy public tables, planner schema move, baseline tables, work queue/facts and later connector migrations exist, but static inspection does not establish a clean fresh replay. Report a historical-chain failure separately from the additive recovery migration; do not silently call `db push` a migration pass. Production migration/backup/cutover remains excluded.

Remove temporary containers with `--rm`; stop/down the specific synthetic stack after testing. No volume deletion/pruning, production database access, provider runtime or restored migration data is required.
