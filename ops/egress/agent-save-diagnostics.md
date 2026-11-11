# Agent save diagnostics acceptance

Owner approved LOCK/QAR/ARCH/RISK on 2026-11-11 in the engineering chat. Source contract: ops/egress/agent-save-design.md. Scope is local implementation and synthetic Docker verification; no production changes or outage injection.

S1 pre-commit synchronization refusal: HTTP 503, not_saved, no success notification, cause and Redis recovery/retry guidance visible.
S2 genuine typed post-commit pending: committed field marked synchronization_pending, later fields not_attempted, no claim of whole-form save, no automatic retry.
S3 later failure: saved fields retained in result, failed/not_attempted fields distinct; reload/check stored values before repeating.
S4 unknown exception or network loss: result unknown, no raw exception/secret displayed, no blind repeat.
S5 HTTP/client/UI transport: structured diagnostics survive fetch to real Settings mutation and visible toast in RU/EN, desktop/mobile; edits retained, one request per click.
S6 normal success and legacy Error compatibility preserved. Existing cache coordination and authorization regressions remain required.

Backend command: docker compose -f ops/egress/compose.yaml run --rm --no-deps --entrypoint sh checks /source/ops/egress/agent-save-checks.sh

## Delivery / TRUN — 2026-11-11

RED: actual Fastify agent PUT returned general 500 instead of structured 503; actual Settings sent PUT and displayed no toast (5-second locator timeout). Initial UI selector included an icon in the accessible button name; corrected before recording the causal no-toast RED. Initial added PG fixture lacked required slug; corrected as test setup, not product RED. No assertions skipped or production guard relaxed.

GREEN: backend compilation, 13 focused Node tests, 12 sequential real PostgreSQL/Redis tests, 22 existing MCP authorization/profile tests, 2 actual API-client transport tests, and 24 real Settings UI scenarios passed. No failures or skips in final suites. The real PG test commits a setting, fails Redis acknowledgement, asserts typed pending, observes fresh reads, then repairs the durable event without resaving. HTTP tests preserve exact per-field certainty and redact unexpected exception contents. UI scenarios run RU/EN at 375/1280, preserve draft, refuse automatic replay, keep recovery text until dismiss, and assert alert role / viewport fit. CSS entry animation is completed deterministically before layout measurement; lifetime uses a virtual clock, not sleeps.

Frontend TypeScript/Vite build and existing built LinkedIn-origin contract pass. Quality PASS 77; 6823 baseline findings unchanged; no hard stops, scanner/baseline modifications or preservation exceptions. Reviewed mobile screenshot fits recovery notification within viewport. Existing broader UI styling findings are outside this correction.

Implementation: typed post-commit signal, value-free per-field result tracker, structured Error-compatible API response, localized safe recovery copy, scoped persistent error notification. Successful/other notifications retain existing automatic dismissal. Common toast layout corrected for mobile and exposes alert/status and named dismiss button. No whole-form transaction or automatic settings repair introduced.

## Reproduction and UAT

Docker build/test/start/check commands (all use retained reviewed images and resource/sandbox limits in Compose):

```sh
docker compose -f ops/egress/compose.yaml run --rm --entrypoint sh postgres-checks /source/ops/egress/agent-save-checks.sh
docker compose -f ops/egress/agent-ui.compose.yaml run --rm --entrypoint sh build-fixture /source/ops/egress/agent-frontend-checks.sh
mkdir -p /tmp/planner-agent-save-ui
docker compose -f ops/egress/agent-ui.compose.yaml run --rm build-fixture
docker compose -f ops/egress/agent-ui.compose.yaml run --rm --entrypoint node build-fixture /results/client-tests.cjs
docker compose -f ops/egress/agent-ui.compose.yaml run --rm browser
docker compose -f ops/egress/compose.yaml down
```

Browser starts only an internal loopback fixture, asserts the actual Settings page and exits. No ports, provider access, production data or new persistent processes. Temporary containers remove themselves. Output/logs go to stdout; screenshots to /tmp/planner-agent-save-ui. Cleanup preserves volumes; never down -v. CI uses the same browser/client harness with explicitly supplied installed dependency paths.

Human acceptance remains pending: inspect not-saved, partially-saved and synchronization-pending copy and retained draft on desktop/mobile using synthetic fixture/screenshots. Do not stop production Redis for UAT. Production behavior has not been exercised by these synthetic tests. Public PR, CI and deploy remain separate.

Status: ENGINEERING COMPLETE — AWAITING UAT.
