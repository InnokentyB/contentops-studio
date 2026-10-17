# Proposed resource matrix — follow-up receipt

2026-10-17; supplements PR174's original proposal at `37bd89e`.
Status: diagnostic specification/tests only. No mechanism implementation or
human approval is claimed. The packet submitted for human LOCK is unchanged:
SHA256 `674f01d945629902fa8defb4d4a255ef6d8ea3bff7b73448b668aefe75728722`.

Shared fixture construction was extracted into
`tests/fixtures/runtime-policy-transition.cjs`; the original31 proposed cases
continue to invoke the same real gate with synthetic private Git repositories.
The new `tests/tdpd/runtime-policy-transition-resources.proposed.cjs` adds eight
executed cases: old/new source over1MiB, exact1MiB admission boundary, aggregate
source over8MiB while each file remains below1MiB, trusted Git source mode120000
with otherwise valid JavaScript bytes, working-tree symlink rejection, missing
nonzero full40hex commit, and one hung transition Git read.

The hung-read fixture supports ordinary and batched Git read invocations. It
asserts bounded termination, classified timeout and sanitized error reporting;
it does not prescribe how many subprocesses a valid implementation uses.
The source-size/mode/timeout cases require classified rejection, so the old
gate's blanket `BASELINE_WIDENED` is not mislabeled as verification of those
new controls.

## Diagnostic result

Temporary Tower containers used the existing reviewed quality Compose/image,
non-root, network none, read-only source/root and bounded temporary storage.
No project workload, Git wrapper or fixture ran on the Tower host. The private
Git wrapper is generated only inside the test container's temporary fixture.

Explicit command:
`node --test --test-concurrency=1 tests/tdpd/runtime-policy-transition.proposed.cjs tests/tdpd/runtime-policy-transition-resources.proposed.cjs`.
Result: **39 executed,29 passed,10 expected RED,0 skipped**. Four RED cases are
the original missing admission/trusted-base behaviors. Six additional RED cases
are old/new/aggregate source limits, exact-size admission, trusted source mode
and bounded transition-read handling. Current working-tree source symlink and
missing-full-commit checks pass through the existing protections. These runs
do not represent final approved acceptance scenarios or implementation GREEN.

Current `npm run quality:gate` with full trusted base190621a: **PASS**,7096
findings/baseline entries and no hard stops. No application/build inputs,
scanner, baseline or workflow changed. Accepted36 policy tests remain supported
by the preceding run; no repeated application build is claimed.

Raw diagnostic output: `/tmp/runtime-policy-transition-resources-final.log`.
Quality output: `/tmp/runtime-policy-expanded-quality.log`.

## Remaining deterministic budget execution

`tests/fixtures/runtime-policy-budget-scenarios.json` contains six reviewed
case-data specifications: shrinking remaining timeout with refusal of the next
read; successful batching; child timeout with sanitized stderr; many short reads
sharing one deadline; metadata/blob reads sharing that deadline; and32-read cap.
They are explicitly **NOT_EXECUTED**, not tests counted among the39 results.

After human LOCK, wire these cases into deterministic clock/I/O tests of the
approved developer-control implementation, without a production permission
seam. They must prove `min(1000ms,remaining2000ms)` and no read after exhaustion;
do not use wall-clock races or a required Git batching strategy. This remains a
mandatory before-GREEN step, not grounds to implement the mechanism pre-approval.

## Independent static review

Reviewer `/root/dzen_runtime_review_retry` found R27–R32 and fixture extraction
acceptable. One P2 against the original multi-read wall-clock test was corrected:
the revised test checks a single hung read and leaves shared-budget arithmetic to
deterministic case data. Final verdict: no open P1/P2 in reviewed proposal/tests;
all six budget-case calculations match the packet limits. Reviewer performed no
new runtime runs or source changes and grants no implementation/admission.

Reviewed SHA256:

- Resources: `cb372e9386c9c0ff049fcd889ddaab66e3177d41a44ce402481f5bf26ba46924`
- Budget cases: `47af25f1eb64df9bad35a1a42a11696238de13a9a89afc080b9ee79ef675d6c1`
- Fixture: `1dd8ffb2a0a7e20bd0513444e1a98685c501a6e6ea46875fd895086f80a19106`

No live credentials, provider calls, real transition artifact, merge, deployment
or publication fact is part of this work. Human approval remains pending in
Portfolio OS; no duplicate approval request is issued here.

## Six scenario reachability diagnostics —14:24 UTC follow-up

The six case-data configurations have now each been supplied to an actual gate
invocation using test-only child-process clock/Git-I/O instrumentation. Explicit
command: `node --test --test-concurrency=1 tests/tdpd/runtime-policy-budget.diagnostic.cjs`.
Tower Docker result: **6 executed,0 PASS,6 diagnostic RED,0 skipped**, exit1.

Every run had a valid one-finding/one-row synthetic fixture and returned exactly
`FAIL/BASELINE_WIDENED`, before any transition I/O. Each trace recorded zero
transition reads, no observed timeouts and zero fake-clock consumption, classified
`RED_MISSING_TRANSITION_MECHANISM`. Preload initialization was verified; other
CLI/fixture errors are explicitly classified separately and cannot count as this
expected RED. This is a behavioral reachability limit, not a broken runner.

The six executions cover submission of each scenario configuration: decreasing
remaining budget; successful batching; child timeout; repeated short reads;
shared metadata/blob budget; and read-count cap. **They do not execute or prove
the six budget acceptance behaviors.** The absent transition path prevents the
configured fault/clock sequence from being exercised. The original case-data
status remains NOT_EXECUTED for acceptance semantics; no budget operator was
implemented inside either the gate or the probe to manufacture a result.

The probe only observes real Git calls, advances test clocks and injects configured
child errors when those calls occur. It does not compute remaining time, enforce
a deadline/count limit, change gate options or grant a remap. Instrumentation is
confined to the child test process. A future implementation may use other clock
or I/O APIs, so the probe must be rebound and full deterministic assertions added
after LOCK; these reachability diagnostics cannot substitute for before-GREEN
budget acceptance tests or be counted as passing admission evidence.

Final raw output: `/tmp/runtime-policy-budget-six-diagnostics-final.log`.
Quality gate remains PASS with7096 findings and no hard stops;
`/tmp/runtime-policy-budget-diagnostic-quality.log` contains that result.

Independent static review by `/root/dzen_runtime_review_retry` closed one P2:
the initial unconditional behavior-gap label was replaced by exact validation of
the expected gate/fixture result. Final review has no open P1/P2 and explicitly
does not grant implementation approval. Reviewed SHA256:

- Diagnostic: `3b4647c0fa80859673cd0d2212a190a0b5e5fb0297dd990294b4214c0a891e8d`
- Probe: `fad341bf25d74dc991c42dd8eb2c6d71225889eb6b8a893a96ada63e167e49b5`

Independent preparatory execution is complete. State: **WAITING_OWNER** for the
already-pending exact decision in Portfolio OS. No repeat tests, new runtime
entity or approval-dependent implementation is warranted until that verdict.
