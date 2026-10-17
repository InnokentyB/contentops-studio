# Reviewed transition implementation — engineering receipt

Owner authorization was read directly from Portfolio OS user message
`01a14acc-d0e3-7a52-b2a1-bc2df847df4e`: “Утверждаю пакет”. Exact packet hash and
scope are retained in `runtime-policy-transition-owner-approval-2026-10-17.json`.
The original reviewed packet bytes remain unchanged. Approval covers developer
mechanism implementation/tests, not merge, deploy, real exception admission,
provider-policy clearance or publication.

## Implementation and operator boundary

The existing offline gate can validate an exact task-identifier context
replacement only against a strict record already present at the trusted event
base. Current branch data cannot authorize itself. Full old/new source bytes,
Git modes, symbol, declaration signature, count and existing owner/reason/
remediation are checked. Non-remappable rules keep their exact no-growth check.
No baseline writer, auto-update command or real transition record is installed.

CI rejects missing/invalid event bases and dispatch/CLI substitution independently
of the current artifact. Local HEAD is used only to detect growth and demand an
explicit comparison; it never authorizes a remap. All active sources are bounded
and hash/mode/aggregate-checked before context AST. One monotonic2s budget covers
transition reads/comparison, at most32 reads of at most1s each, with remaining
time decreasing. Failures have sanitized classified codes. Applied mappings are
reported without source or review text.

Changes are limited to offline scripts, test fixtures, workflow base propagation
and documentation. Application/provider code, production data and the approved
7096-row baseline are unchanged. Both CI quality invocations receive the event
base; the Dzen checkout now has the history needed to read it. New admission and
budget tests are included in the existing audit job, with no existing check removed.

## TRUN and causal findings

All local project execution used temporary non-root Tower Docker containers from
the existing reviewed quality/build Compose. Source/root read-only; no network
for checks, no capabilities, no-new-privileges and bounded CPU/RAM/PID/storage.
Builds use the reviewed Dockerfile and locked public dependencies. No DB,
browser, social session, credentials or application service was started.

- Pre-implementation:39 proposed checks,29 PASS/10 RED; six diagnostic scenario
  submissions also RED before transition I/O. These were not budget acceptance.
- First implementation run:46 tests,44 PASS/2 fixture failures. The fake-clock
  test's optional-chain increment did not advance its data index; fixed that
  fixture. The Git timeout PATH shim was silently bypassed on `/tmp` mounted
  `noexec`. Replaced it with an explicit Node-interpreted child fault retaining
  the real child timeout; container protections stayed intact.
- Initial full run:82/82 PASS, zero skips. Independent review then found two
  real defects, so this was not treated as final completion.
- Added reproduction:44 tests,39 PASS/5 RED: deleting the current artifact let
  three CI contexts and a local no-base comparison bypass enforcement; aggregate
  size rejection occurred after AST. These reproduced before their fixes.
- Final focused plus existing policy tests: **90/90 PASS,0 failed/skipped**.
  The existing36 tests remain, alongside transition/source/CI/replay negatives,
  six deterministic fake-clock/I/O budget cases and a buffer-overflow case.
- `npm run quality:gate`: **PASS**, score77/minimum77,7096 findings/baseline,
  `appliedTransitions=[]`. No real exception is admitted by that result.
- Backend/frontend build: **PASS** in the reviewed build-check Docker target.

The six budget assertions now execute the real developer-control budget helper:
shrinking timeouts, refusal after deadline, batching compatibility, child timeout
sanitization, shared metadata/blob budget and32-read cap. They do not use a
publication permission seam. The earlier reachability diagnostics remain separate
historical evidence and are not counted as budget acceptance.

Raw local receipts: `/tmp/runtime-policy-implementation-first.log`,
`/tmp/runtime-policy-review-repro.log`,
`/tmp/runtime-policy-implementation-review-fixed.log`,
`/tmp/runtime-policy-reviewed-quality-final.log`,
`/tmp/runtime-policy-approved-build.log`.

## Independent review closure

Reviewer `/root/dzen_runtime_review_retry`: final implementation review PASS,
no open P1/P2. Independent Tower Docker run: **54/54 PASS,0 failed/skipped**,
including the reproduced deleted-artifact bypass, local compatibility, resource
caps and six budget cases. No reviewer edits or provider actions occurred.

P1 closure: event-derived base is mandatory in CI regardless of mutable artifact
presence; local committed baseline growth also demands an explicit comparison.
P2 closure: preflight all consumed source sizes/modes/hashes and aggregate cap
before any context parsing. R29 instruments the context boundary and proves
zero context calls when aggregate size exceeds8MiB.

Reviewed source SHA256:

- Gate: `33471467e59f4f522f8060c5830b2657c76f1e73bae6dd27b6565c05e5a3e8a7`
- Transitions: `fa96876e743145a452d10547e3b59841011194559fff0d3bdd9964ba4569056e`
- Schema: `da00c07dc078f412910ff653552a99e2f2722fd6e697dedb3969a5261965a643`

## Practical next step and limits

`browser-sandbox-transition-candidate-2026-10-17.json` is an evidence wrapper
containing exact full source hashes and the six already reviewed PR172 context
pairs. It is not at the authority path and is not a valid root admission record.
Its staging/remap remains subject to separate exact source review and authorized
two-stage delivery. No approver or permission flag was manufactured. Dzen source
files were rechecked unchanged from190621a through canonical main d233b2b.

Before handoff, integrate current main without changing the reviewed scripts,
repeat focused verification for that integrated revision, and obtain current-head
CI results. Those final integration results are recorded separately below or in
the linked PR checks. Owner UAT and any merge/deploy authority remain explicit.
The shared Dzen adapter/container migration and unresolved provider-policy
applicability are separate; this developer gate does not supply either.
