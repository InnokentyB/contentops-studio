# DZEN1002-RUNTIME-001 delivery evidence

## Authority

Human in dedicated Dzen chat01a145fc-e669-7431-a0ff-bd21782ac476 on2026-10-16:
«Тесты методы также всё покрыто уже. То есть мы готовы к реализации.»
Assistant acknowledged permission to implement the exact reviewed packet; Portfolio
OS read the actual human turn and confirmed the implementation verdict. Approved
LOCK/QAR/ARCH/RISK packet SHA256:
b32a94634da169358990c5462223341fbf6b06cf717bc0012b5b3a7c28784def.
The packet remains an immutable historical proposal; this document records delivery.
No deployment, native permission, publication or owner UAT was inferred.

## Implemented boundary

Current Planner server owns the dedicated task1002 native adapter. Serializably
claim the exact release3126 package and DeliveryAttempt before mutation; a unique
started event fences the only invocation. Persist verified immutable receipt
before canonical fact completion. The existing beforeWrite transaction hook
atomically completes attempt/fact/task/audit; DB-only reconciliation handles a
retained receipt, concurrency and lost responses without another native send.
Generic MCP/REST fact/confirmation writes for task1002 reject at the shared guard.
Other provider packages and historical operational rows were not modified.

The fictional admission-source callback is removed. All production native entry
points return DZEN1002_ACTION_SCOPE_UNRESOLVED before session/provider access.
This is an application action-scope status, not a fresh Dzen error. Original1045
public-article refusal remains binding; neither adapter ownership nor owner GO
clears it. Native proof schemas and DOM paths are fixture-verified, not confirmed
against live Dzen. Unsupported shapes freeze rather than fabricate success.
The new command ba_reconcile_dzen_task1002 is receipt-only; it has no send or
arbitrary URL/transport/session parameters. Future native enablement/readback
requires supported action-specific evidence and a separately reviewed change.

## Test runs (actual, per build)

- Baseline ffe3435 before implementation: backend build PASS;84 old tests PASS;
  quality77/min77 PASS. This was never new-code coverage.
- RED orchestration/policy/generic guard:8 executed failures, each missing behavior;
  bounded reconcile MCP command then reproduced one additional missing-command
  failure. No environment/module-resolution error was counted as RED.
- RED native proof26, sequence3, entry2 behavioral failures; subsequent fake-Page
  verification expanded to39 PASS after final-control correction.
- Store RED6 actual PostgreSQL tests failed for missing store behavior after
  successful isolated fixture setup. Historical pre-retirement PG suite expanded
  to13/13 PASS, including Serializable races, rollback and response loss.
- New user Docker retirement instruction applied immediately. Only this chat's
  disposable synthetic Mac test container was removed; no project volume touched.
  No further Mac container/daemon was used. tower-linux SSH reachable, but Docker/
  PostgreSQL runtime not found. The final runner uses SSH to tower only, never Mac.
- Independent code review found P1 receipt lost after post-submit mutable drift
  and P2 checked/clicked final-control mismatch. Both corrected. New receipt custody
  unit tests2/2 PASS; real post-submit drift scenario added to14-test PG suite.
- Final offline focused run:51/51 PASS,0 skipped (commands, actual MCP/REST fact
  handlers, receipt custody and native proof/Page/entry fixtures).
- Backend build after corrections PASS. Relevant compiled regression97/97 PASS,
  zero skipped. Quality gate PASS77/min77/no gate hard stops. Diff check PASS.
- Independent follow-up implementation review: both findings closed, no remaining
  P1/P2. Reviewer independently ran41 offline tests, all PASS, no skips.
- Linux CI at code14874df, run38952148492: all four jobs PASS. Dzen job
  117145913672 ran14/14 actual PostgreSQL tests PASS,0 skipped, including the
  post-submit drift correction. Other provider regressions and shared gate PASS.
  Existing-repository GitHubActions pattern was explicitly authorized; no paid
  runner, new secrets, self-hosted runner or production database.
- Final targeted review identified R08 stale publication timestamp before attempt.
  Added deterministic attempt time and immutable receipt lower bound with120-second
  clock tolerance. RED had two decisive missing-rejection failures; custody suite
  then5/5 PASS. Expanded real PostgreSQL suite15 tests awaits new-head CI; earlier
  14 PASS remains exact14874df evidence. After the timestamp fix,54/54 offline
  tests PASS, TypeScript/backend build and quality gate PASS; independent
  timestamp follow-up review closed P2 with5/5 tests independently rerun.
  Canonical current verification is the
  Dzen1002 check attached to PR165, not the historical numbers above.

Local commands:

    npm run build:backend
    npm run quality:gate
    node --test --test-concurrency=1 tests/tdpd/dzen1002-runtime.test.cjs tests/tdpd/dzen1002-fact-boundary.test.cjs tests/tdpd/dzen1002-store-custody.test.cjs tests/tdpd/dzen1002-native-*.cjs
    node tests/fixtures/run-dzen1002-store.cjs

The last command requires verified Docker on tower-linux through SSH and fails if
unavailable. CI runs Prisma push and the store suite against a synthetic, isolated
Postgres service; it never loads a production env file. Test DB URL validation
rejects anything outside that explicit synthetic localhost database.

## Compatibility and rollback

No schema/dependency/application-environment change. The only new environment name is a
mandatory synthetic test DB input in tests/CI, documented empty in .env.example;
it is not an application configuration.
Adapter requires exact same-account/object primary body and approved original
cover bytes; transformed/missing cover or unsupported response is uncertain.

Rollback to PR159 retains its closed admission guard. Do not roll back to a
pre-guard sender. Preserve every claim/start/attempt/receipt/fact/audit; never
reset/release an expired or uncertain attempt to resend. Receipt persistence
survives post-submit owner/package/manifest drift; completion still requires
current ownership/package/manifest and retains the original release snapshot.

Baseline proxy-addr critical advisory has a separate bounded source reachability
assessment; production config was not inspected and no dependency upgraded.
No production credentials, DB rows, provider request, live browser, send or
publication fact was accessed/created. Engineering completion is withheld until
required fresh CI results. Owner UAT remains explicit after engineering gates;
no native readiness, publication success or rollout acceptance is claimed.

## Host infrastructure readback (separate from platform policy)

Portfolio OS reported a read-only tower-linux check: project Node dependencies
and downloaded Puppeteer browser are present, but a memory-HTML-only headless
launch failed code127 because system libatk is missing; additional GUI/audio
libraries are absent, and Docker/Podman are not in PATH. No libraries or services
were installed by this chat. This is host infrastructure evidence, not Dzen
permission, Railway production readiness or a provider response. CI runs on its
own Linux runner; no actual Dzen/browser smoke was inferred.
