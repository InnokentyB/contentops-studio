# DZEN1002-MANIFEST-001 delivery

## Approved boundary

LOCK/QAR/ARCH/RISK approved by direct human reply
`01a14420-4343-7460-8797-68ec62b0ba86` in Portfolio OS
`01a0df21-ea6c-71f2-9c1b-40393de0e105`, 2026-10-16:
“Утверждаю DZEN1002-MANIFEST-001”. Main agent read the actual human question
and answer. Exact decision packet was
`docs/tdpd/dzen1002-manifest-drift-minimal-delta.md` in the originating checkout.

Scope: exact reviewed manifest
`sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7`
for existing p10/task1002 release/preflight/publish. No provider action, denial
override, renewed release or UAT acceptance is authorized by this engineering
approval. It supersedes only the prior exclusion of this exact manifest rebind.

Historical event3126 remains under its original manifest and is not rewritten.
Body rev3, decision300/version2, approved asset151, both hashes and both dates
remain unchanged. Existing uncertain/started work permits reconciliation only.

## Change and architecture/security review

One small independent manifest module holds the explicit checksum and scoped live
comparison. This avoids embedding new manifest machinery in the pre-existing
886-line publication module: that module only calls the extracted guard in its
task1002 branch. No general decomposition or unrelated route change is included.

Release/preflight share the updated literal. Publish now additionally requires
actorId and expectedManifestChecksum, checks current owner membership and live
manifest before reading cached results, attempts or provider work. Remote MCP
continues to bind actorId from the authenticated principal. Other tasks retain
their prior inputs and behavior. Missing/stale checksums fail closed; Ops must
reload the tool schema after deployment, not reuse old publish inputs.

No DB migration, data write, new adapter, session, permission or retry mechanism.
Rollback may restore a blocked/stale route, not mutate history or resend. The
manifest read is an admission-time comparison, not an atomic lock against all
future workspace edits during provider execution. Existing provider admission
and attempt fencing remain separate; no stronger race guarantee is claimed.

## Test run log

- Setup: clean isolated worktree, npm ci --ignore-scripts; initial test launch
  failed because generated Prisma client was absent. This was setup, not RED.
- Generated client locally; test environment uses synthetic loopback DB URL on
  port1. No production credentials copied into the worktree.
- RED: five executed behavioral tests failed on old schema, absent manifest/
  owner checks before cached replay, missing rejection for drift and missing actor.
- GREEN initial: all five executed tests pass after implementation.
- Additional scenarios: shared guard/current identity, loader failure, complete
  preserved release/package dry-run, existing pending attempt refusal, immutable
  release fixture, provider/fact functions forbidden. CI executes this focused
  suite explicitly plus existing inventory/route regressions.

Final focused/build/quality/regression/CI results and commit are recorded in the
PR and handoff. Independent read-only review found no actionable P1/P2 in the
implementation; it did not run provider/DB operations or establish native UAT.

Local final verification on2026-10-16: backend build PASS; expanded Dzen,
delivery, release-schedule, exact-route and VK no-fallback regression208/208 PASS;
quality gate PASS score77/min77/no hard stops; diff check PASS. An earlier broader
test launch lacked the synthetic TELEGRAM_BOT_TOKEN required by the existing
suite and failed at module setup; rerun with the same synthetic token as CI
passed all208. No assertion was weakened or skipped. Final independent review
after additional tests/CI/docs: no actionable P1/P2. Owner native UAT remains
unexecuted and cannot be inferred from these fixtures.

## Ops handoff after reviewed deployment only

Load fresh manifest and tool schema. Dedicated preflight remains
`ba_preflight_dzen_task1002` with projectId10/taskId1002, authenticated actor,
the exact reviewed expectedManifestChecksum above,
expectedBodySha256 `570bf2c102911ae4fc678ad453bb0289e48cf4e6161e874d6e39811e2527e9bb`,
expectedScheduleAt `2026-10-13T11:30:00.000Z`, existing owner approvalReference
and an operation idempotency key. Do not invoke release again.

Use only Planner -> registered independent adapter. Denied/unavailable admission
stops before native access; neither this fix nor owner approval clears denial.
Publish additionally requires actorId/current expectedManifestChecksum, but no
publish invocation is part of this control-plane repair. Fixtures/build/CI do
not establish native inventory, cookies, end-of-list proof or publication success.
