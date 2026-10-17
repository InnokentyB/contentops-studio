# Browser sandbox correction — implementation checkpoint

2026-10-17, baseline `0f457ea97ebbdc20391beeaeea3523831208a5e3`.
Status: draft PR candidate; quality gate blocked; no deployment or UAT.

The existing native Dzen inventory and publication launchers explicitly disabled
Chromium sandboxing. Both now retain Puppeteer sandbox defaults. This removes
three launch arguments and adds no command, business binding, authorization seam
or provider call. Existing action-scope restrictions and cleanup remain intact.

Operator boundary: the existing Planner-owned adapter entry points. This repair
does not enable live entry. The independent provider scope finding remains
unresolved; the shared browser lifecycle currently supports LinkedIn and DEV.to,
and does not supply a reusable Dzen adapter merely by passing these tests.

## TRUN

All execution used temporary, non-root, network-disabled Docker containers on
`tower-linux`, from a secret-free source snapshot in
`/home/innokenty/projects/contentops-dzen-check-0f457ea`. No application service,
social session, publisher or scheduler was started. No database was contacted.

1. Initial runner attempts failed setup: relative test paths resolved against
   the image directory, then legacy logger initialization required a writable
   `/workspace/logs`. These are runner errors, not behavior RED. A bounded 16 MiB
   temporary logs mount resolved initialization; source remained read-only.
2. Baseline: 54 passed, zero failed/skipped.
3. RED: both new native launcher checks failed because launch options included
   `--no-sandbox` and `--disable-setuid-sandbox`; four existing entry checks passed.
4. Correction: remove explicit launch arguments at the two existing launch sites.
   Both checks observe options from the actual entry and verify browser cleanup
   after a synthetic page failure. They do not access Dzen or claim native UAT.
5. Regression: 56 passed, zero failed/skipped. The six suites are runtime,
   fact-boundary, store-custody, native-entry, native-page and native-proof under
   `tests/tdpd/dzen1002-*`; test concurrency is one.
6. Backend and frontend compilation succeeded inside the existing reviewed
   `ops/quality/Dockerfile` build-check target. No production image was deployed.
7. `npm run quality:gate` failed its runtime-policy check: six replacement
   `task_identifier` fingerprints and six stale baseline entries across the two
   existing task-specific functions. The scanner fingerprints entire function
   declarations including their bodies, so the security correction changes their
   identities. Finding count remains 7096; this is not an exemption or a PASS.
   No baseline or gate code was modified. Other quality invariants passed.

Raw run outputs on the operator Mac: `/tmp/dzen-baseline-pass.log`,
`/tmp/dzen-sandbox-red.log`, `/tmp/dzen-sandbox-green-final.log`,
`/tmp/dzen-sandbox-quality.log`, `/tmp/dzen-sandbox-build.log`.

CI run `39036219323`, Dzen job `117406404144`, at commit
`389a92627caa402db289d627aedfd095fa4bbc99` independently completed backend build,
56 offline/native fixtures, 95 compiled regressions and 15 real PostgreSQL tests:
all tests passed, zero skips. That job failed only at its final quality gate with
the same six new and six stale fingerprints. The separate quality job failed for
the same reason. Shared-browser, LinkedIn1128 and Threads1114 jobs passed. Source:
https://github.com/InnokentyB/contentops-studio/actions/runs/39036219323/job/117406404144
The CI PostgreSQL result is reported separately from the network-disabled Tower
run; no Tower database or provider access is inferred from it.

## Independent implementation review

Reviewer: `/root/dzen_runtime_review_retry`, exact commit
`389a92627caa402db289d627aedfd095fa4bbc99`, 17 October 2026.
Verdict: no new actionable P1/P2 findings. No findings were waived or closed by
changing the baseline. The reviewer independently reconstructed all six mapping
pairs in isolated Tower containers and confirmed unchanged symbols, anchors and
each occurrence count of one. A full scanner comparison found exactly six old
and six new identities, no other finding changes, 7096 findings before and after,
and zero scanner errors. Six focused entry/cleanup tests passed with zero skips.
The reviewer independently reproduced the runtime-policy FAIL: six
`NEW_RUNTIME_POLICY_DEBT` plus six `STALE_BASELINE_ENTRY` errors.

The source review confirmed that the production diff only removes launch
arguments at two existing sites, with no new authority bindings or weaker guard,
tenant, receipt or idempotency controls. This independent review is evidence for
the security correction and proposed exact mapping, not admission by the gate,
human policy review, native integration or owner UAT. The reviewer made no source
changes, comments, commits or provider calls.

Review receipt recorded at `2026-10-17 13:37:19 UTC` (receipt time, not individual
run timestamps). Commands included `node --test --test-concurrency=1
tests/tdpd/dzen1002-native-entry.cjs` and `node
scripts/check_runtime_policy.cjs --base-ref
0f457ea97ebbdc20391beeaeea3523831208a5e3`; separate stdin AST/scanner comparisons
used trusted Git base source and the read-only checkout. Existing quality/build
images ran with UID1000, network none, read-only source/root, dropped capabilities,
no-new-privileges, 2 GiB/2 CPU/256 PID limits and temporary storage. Reviewer raw
outputs/scripts remain in the tool transcript, not separate saved files. Processes
exited and containers used `--rm`; no separate reviewer post-run container
inventory was taken, so independent container-cleanup inventory is not claimed.

## Outstanding

The exact fingerprint replacement needs review under the runtime-policy contract
before the gate can pass. The six old/new identity pairs, unchanged symbols,
function anchors and per-row counts are recorded in
`browser-sandbox-fingerprint-proposal-2026-10-17.json` with status
`PROPOSED_NOT_ADMITTED`. This document and that JSON are evidence only, never
inputs to the scanner or runtime.

The current gate explicitly rejects every new identity against its trusted base;
even replacing just these six baseline identities would produce
`BASELINE_WIDENED`. The approved packet permits reviewed exact exceptions, but
does not define a migration mechanism for this comparison. Therefore this PR
does not silently implement one. The smallest proposed policy repair is an
independently reviewed, exact replacement of these six identities, retaining
their existing owner/reason/remediation and count, bound to the two-line source
diff. A general mechanism for such replacements must require trusted review of
the exact before/after source and a one-to-one mapping; equal aggregate counts
alone cannot authorize it. Gate tests must continue to reject new task branches,
duplicates, broader bindings, mismatched source and resurrection of removed debt.
The gate/scanner owner should implement that policy repair once its review
contract is accepted, separately from this runtime fix; no competing implementation
is included here. Removal plan: retire these mappings with the corresponding
task-specific adapters when the shared lifecycle replaces them.

Do not regenerate the baseline, admit new task-specific authority or weaken its
trusted-base comparison to hide the failure. A reusable
Dzen lifecycle, adapter/container integration, provider-policy applicability and
explicit owner UAT remain separate unresolved delivery requirements.

The draft change contains source, focused regression tests and review evidence
only. No merge, deploy, live request or publication fact is authorized by it.
Rollback is the two-line launch-options diff; no data changes or cleanup of
database volumes are involved.
