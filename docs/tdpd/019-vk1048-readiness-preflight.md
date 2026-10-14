# VK1048-ADM-001 — approved readiness-only delivery

Issue: https://github.com/InnokentyB/contentops-studio/issues/143
Decision packet: issuecomment-6167975083. LOCK143/QAR143/ARCH143/RISK143 approved
2026-10-14 by the actual owner answer «Утверждаю пакет #143», Portfolio OS turn
01a13a61-c070-7760-a82b-402c8ae80ca4, user message
01a13a63-4729-7511-9e90-ae05d66b536f. This approval grants engineering only;
existing action/site denial and frozen publication state remain binding.

## Operator boundary

The implemented `--operator-preflight` entry uses the existing registered adapter
and private configuration. It reads ONLY ba_preview_vk_connector_dispatch,
ba_get_vk_connector_job and ba_get_vk_connector_health. Actor/project/task/job/host
are pinned; the package must be exactly
00636df473f9fae9f7dee61a3c358d5c64e3f28b8e856aed8374c1302bc2aaea. It checks the same
job before/after diagnostics and reports SNAPSHOT_CHANGED on drift. It never
polls, registers/reassigns a host, issues a challenge, acquires/releases a consumer
lock, resumes, reconciles, uploads, sends or records a fact. No schema migration,
credential change or new queue is required.

Private resource checks inspect directory metadata only: configuration presence,
owner,0700 permissions, non-symlink and directory kind. They neither read profile
contents/cookies nor create directories. Dependency PASS means the Playwright
library resolves; installed browser assets, login, rights and provider inventory
are NOT_CHECKED. Do not turn that PASS or online heartbeat into provider readiness.

The default admission remains ACTION_TIME_ADMISSION_UNAVAILABLE. Production
preflight has no browser launch or provider access and productionReady is always
false. There is deliberately no new production authority or config/env permission
flag. The offline-only fixture seam is never supplied by the CLI and outputs
OFFLINE_FIXTURE_CHECKED with productionReady=false; it cannot certify live VK.
Provider checks in an actually permitted context remain a separate unresolved
boundary, not a hidden automatic next step.

## Limits and safety

120-second total work deadline,30-second cleanup deadline,100-object fixture
observation bound, fresh heartbeat30 seconds. No retries. Missing/denied admission,
invalid control, scope/package drift, timeout or unknown media/login/admin state
cannot execute. Started/uncertain jobs produce RECONCILIATION_REQUIRED without
rebind or resend. Close failure reports UNKNOWN/quarantineRequired; it must not
release another process lock or retry. All result projections remove paths,
credentials, wall bodies and raw exceptions.

New modules isolate the coordinator and resource inspection from the existing
worker. Existing polling/operator-run/operator-reconcile semantics remain intact;
none is invoked by preflight. The card's read-only adapter status adds the explicit
admissionReason diagnostic while retaining its original job blocker and disabled
VK send action.

## Traceability and acceptance

PF143-01..12 cover production denial/read allowlist; missing resources; positive
fixture/provenance/sanitization; negative login/admin/inventory/media/cardinality;
uncertain state; timeout/cleanup; mutation refusal; state drift/foreign scope/
stale heartbeat; private resource metadata; worker closure/no-files/no-secret;
rejection of config-manufactured authority; and production SDK failed-handshake ownership/cleanup. Frontend scenarios retain the
method selector's zero-write behavior and now display the exact admission reason.

RED:8 tests failed for the absent new module before implementation. Independent
review's initial pre-build module-missing run is separately UNAVAILABLE, not a
behavioral regression. Review found sync-exception assertion and unbounded CLI
transport close; both repaired. Overlapping local compiles were stopped and one
final serialized backend build completed; no test assertion was weakened.

Engineering pass is not owner UAT or positive live evidence. Issue143 remains
open pending real action admission and permitted positive/negative provider UAT.
Rollback: revert the additive mode and diagnostic field; preserve schema, job,
release, lease, attempts, facts, profile, private config and managed consumer.

Final verification:12 focused tests, independent12-test review,1095 backend
regression tests,7 mocked-API browser scenarios, UI contracts, frontend/backend
builds, consumer bundle and quality gate pass. Isolated esbuild CommonJS emission
caused a dynamic-import resolution failure in worker tests; TypeScript CommonJS
emission restored the correct runtime after full typecheck. This infrastructure
error is retained in TRUN. Actual control/local-only smoke returns BLOCKED,
ACTION_TIME_ADMISSION_UNAVAILABLE, online, generation3, exact package, UNCONFIGURED
profile/evidence. It makes no VK request and is not live negative provider UAT.
