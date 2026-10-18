# Dzen adapter lifecycle TRUN

Package: DZEN-ADAPTER-LIFECYCLE-001, owner-approved on2026-10-18.
This is a running engineering log. No GREEN, real adapter readiness, deployment,
publication or UAT is declared before corresponding fresh evidence is recorded.

Source baseline main8748b95 plus approved plan/review6b06b1c. Primary conflicted
checkout untouched; isolated branch codex/dzen-adapter-lifecycle. All project
execution is in Docker on tower-linux with synthetic data only.

## Integrated run, before final review

- Parent boundary suite: 15/15 passed, 0 skipped. Actual registered MCP schema,
  scoped principal context, existing router with private adapter fixture, mixed
  VK queue, canonical fact hooks and protected mutators/status. This does not
  claim a full remote HTTP round trip. Log: owned-publication-parent-green.log.
- Backend TypeScript and frontend build: PASS in Tower Docker; no application
  startup. Image planner-owned-lifecycle-build:20261018. Log:
  owned-lifecycle-build-second.log. This snapshot predates invocation budget repair.
- Focused compiled regression: 169 passed, 3 failed, 0 skipped. All three failures
  are connector standalone artifact ENOENT, absent from the build image. The image
  recipe now builds that existing artifact; fresh regression remains required.
- Runtime policy scan: no new findings; 7094 findings versus 7096 baseline entries.
  Two stale exact identities from the removed task-specific fact isolation branch
  were pruned, with no added baseline debt. Fresh integrated gate remains required.
- Native isolated suite: 19/19 passed before the shared invocation budget repair.
  Tower native-green.log SHA256:
  a4d1bda61b17e7ce88da71273e6402524c75085193714ad6b5c1d8ab8e030998.
  Temporary native containers removed. Final rerun required after budget changes.

An integrated review identified that per-command deadlines did not prove the
approved whole-invocation 240-second budget. Repair and failing acceptance cases
are in progress. No completion, UAT, production readiness or live permission is
inferred from the partial passes above.

## Review corrections and subsequent evidence

- Shared invocation budget RED: preserved pre-budget snapshot passed25 tests and
  failed2 behavioral deadline cases. Inventory+publish ran beyond250ms; a locked
  PostgreSQL query ran beyond100ms. Corrected code cancels SQL server-side and
  joins native phase hooks rather than abandoning writes behind Promise.race.
- Actual PostgreSQL suite expanded to32/32 PASS,0 skips, including canonical
  mutator row locking, actual content writer vs release in separate processes,
  actual production facade scope and fact authorization blocked by a real table
  lock. The latter had a separate pre-fix behavioral RED (1200ms safety unlock
  versus100ms budget). Final REST additions remain under verification.
- Parent context/queue/fact/writer suite plus real HTTP transport:16/16 PASS.
  HTTP uses actual remote-server, SDK and registered publication callback;
  private fixture replaces persistence/provider ports only. Owner and scoped
  publisher retain distinct token principals; forged actor and foreign tenant
  are denied. This complements, and does not substitute for, actual-PG facade tests.
- Compiled Dzen/auth/delivery/VK/fact regression:172/172 PASS,0 skipped after
  building the standalone connector artifact and making only its output directory
  ephemeral/writable in the read-only test container.
- Additional publication regression:190/192 PASS,0 skipped. Two existing manual
  fact guard mocks lacked the new history-query ports; fixtures corrected while
  retaining original active/resolved pilot assertions. Fresh compiled rerun required.
- Default registered command regression RED exposed that non-Dzen local calls
  unnecessarily required the new principal. Corrected facade classifies only
  tenant-scoped provider metadata in that legacy context, retains existing
  non-Dzen authorization and rejects owned execution before package/session work.
  Existing token scope is checked before even classification. No owner inferred.

Independent WIP review remains BLOCKED pending the recorded REST writer, actual
retirement UNKNOWN marker, session SQL, native one-request create/submit and
startup resource-custody corrections. Their intermediate successes do not count
as final integrated completion. Review receipt is versioned separately; an exact
implementation commit review and fresh checks remain required.

## Frozen candidate and review closure

The final source review pins48 production/runtime/CI/runbook files in the review
receipt. Local byte-for-byte comparison confirms every pinned hash matches.
No open P0/P1/newP2 remains in that source scope; reviewer did not execute tests.
Final compiled native28 evidence and exact committed-head check remain pending.

Current unaffected-boundary regressions:203/203 publication/content/image/X-length
checks;172/172 compiled Dzen/auth/delivery/VK checks;74/74 shared browser/Setka/X
checks, all0 skips. The first shared run's2 failures were wrong working-directory
fixture reads (.env.example/workflow absent in image cwd), not behavior RED. The
correct mounted-source working directory passes all74.

The latest native corrections are evidence-driven: stale persisted body behind
old editor DOM; body drift while awaiting the DB Submit fence; and an already
admitted, unfinished own autosave racing fresh proof. Each has a real fixture RED.
The final native source uses read-only cutoff, bounded request drain and fresh
same-object proof before arming its one outgoing Submit. This does not claim a
universal provider CAS against other actors. It also refreshes actual post-submit
body/cover before receipt acceptance.

Policy debt was reduced by exactly3 baseline rows:2 removed task-specific fact
comparison findings and1 generated-visual protocol literal now represented by its
named protocol constant. There are no added baseline rows or remapped legacy
business-task exceptions. The positive approval postcondition runs inside its
original transaction before commit and leaves the legacy facade class unchanged;
actual PostgreSQL proves rollback of all earlier approval writes.

Per-scenario TAP/errors and candidate build/gate logs are retained in
`dzen-adapter-lifecycle-runs-2026-10-18/`. Counts describe their specific runs;
setup and intermediate failures are recorded above and do not stand in for RED.

## Final executed engineering verification

Final source byte manifest and run index are retained beside this TRUN. Docker
image config507161d2b1e013b7b2640364390a6fdb7bade74635bbee0f63702fb7b0bc3556
contains the exact reviewed e97abe42 native source; its compiled page hash is
3e7e7676af130be5adc5ba1ec4db720c974fb71cf0c09224fc5a37205c4f83d1.
The final native suite uses dist extracted from this complete backend build,
not the earlier transpile-only iteration artifact.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Principal/registered command/actual HTTP/queue/fact/mutator/art boundaries |26|0|0|
| Actual synthetic PostgreSQL lifecycle/REST/visual/race/fault cases |41|0|0|
| Actual independent child/sandboxed browser plus strict receipt proof |28|0|0|
| Compiled publication/content/visual/X text-limit regressions |203|0|0|
| Compiled Dzen/auth/delivery/VK regressions |172|0|0|
| Shared browser/Setka/X regressions |74|0|0|

These are suite counts, not a claim of disjoint global test cases. Backend,
frontend and standalone connector build PASS; quality gate PASS with7093 findings
matching7093 existing baseline entries and zero hard stops. The existing quality
score remains baselined; no broad debt exemption or new baseline finding was added.

Native fullbuild28 took105.783s. Actual held-startup browser cleanup took9.269s,
below10s; missing-deadline and stale/pending-body scenarios have behavioral RED
logs followed by passing cases. Awaited drift and pending own-autosave cases
produce zero outgoing publish requests. Normal unrelated packages each retain one
create/Submit and exact original request bodies. Native final log SHA256:
e5b02ec102daa55975a5cb1c9ab185d57f9a79302a8015047429936df2b90c84.
Synthetic PostgreSQL and native containers/networks were stopped/removed; stopped
artifact-extraction container was removed. No volume deletion, production DB,
credentials, queue activation, provider call, merge or deploy was performed.

Remaining handoff gates: exact committed-head review, then explicit owner UAT and
any separately authorized deployment/runtime/action readiness. Production still
holds native inventory/mutation/Submit/readback under unresolved applicability of
the recorded refusal; offline passing tests do not clear that restriction.
