# Runtime-policy transition: bounded scenarios and local execution review

Status: approved design; scenarios ready for test-first local implementation. This document changes no validator, manifest, baseline or production source. Engineering GREEN and owner acceptance are separate. Public release remains blocked until the separately reviewed Stage A is merged into the public trusted base and Stage B passes against it.

## Feature model and observable boundary

Actor: repository maintainer preparing the approved Owner manual-confirmation feature. Boundary: existing runtime-policy checker CLI and its exit status/report, invoked inside Docker against isolated Git fixtures/worktrees. Input: a trusted Git base, candidate source, baseline and bounded transition artifact. Output: exact debt admission or a specific failed check; never new publication authority. No provider, credentials, database or network is needed.

The approved proof is `runtime-policy-transition-pairs.json`: 16 source files, 102 one-to-one identity transitions, 110 occurrences, four named rules, baseline/findings 6,823. Its full hashes and pair list are frozen in `runtime-policy-transition-proposal.md`. Repeated identical leaves are matched in stable source order; each pair retains file/rule/leaf/count. Equal aggregate counts alone are insufficient.

## Testability decisions before implementation

1. Local trusted-base simulation is allowed solely for tests: create Stage A in a separate worktree rooted at current released main, then make a local Git commit. Stage B may explicitly select this local commit as its test base. Label all resulting reports LOCAL_SIMULATION; do not represent it as merged/public authority. Production/default base selection must retain its existing trust boundary.
2. Stage A must have the exact released runtime source and baseline. It may contain validator changes, tests and the compact future-source manifest; it must not quietly include feature guards or baseline remaps. Compare relevant trees, not just working-tree status.
3. The 16 old source hashes are pinned to the approved released base. Before selecting current main for Stage A, compare those bytes and baseline against the approved base. If current main differs, stop and obtain refreshed evidence rather than silently recomputing approvals. Unrelated documentation-only main drift does not invalidate the proof.
4. Existing transition records remain valid under their previous strict schema. The extension must preserve them; it must not reinterpret all legacy records under a weaker generic mode. Exact schema representation is an implementation choice, but rejection behavior and reviewed scope are fixed.
5. Keep the 65,536-byte artifact cap. The 67,044-byte diagnostic JSON cannot be used directly as the production manifest. A compact representation may remove duplicated review prose, but cannot discard source hashes, pair identity/rule/count or same-leaf verification bindings. If the exact compact manifest cannot fit, STOP; do not raise the cap.
6. Diagnostic errors must give a bounded safe reason and repair action. Avoid raw file contents, Git stderr or provider data. A local mismatch means restore the approved bytes or request a refreshed review; it never means bypass the checker.

No additional owner decision is needed for these interpretations. A requested general-purpose transition mode, arbitrary rule/file admission, weaker trust origin, changed limits or automatic re-approval would materially change ARCH/RISK and must return to the owner before code.

## Must-have acceptance matrix

Each row is independent, uses isolated synthetic Git/source data or read-only approved snapshots, and asserts CLI status/report plus no source/baseline mutation. Write the missing-behavior RED first; an infrastructure/import failure is not causal RED. Validator unit tests supplement these CLI tests, not replace them.

| ID | Preconditions and action | Observable expected result |
|---|---|---|
| RP01 | Released validator; exact frozen feature source; original baseline. Run checker. | Causal RED: 102 NEW and 102 STALE; 6,823 counts retained; no acceptance. |
| RP02 | Implemented Stage A local commit; Stage B exact frozen source and exact 102 baseline remaps. Run CLI against explicit local Stage A. | LOCAL_SIMULATION GREEN; 102 authorized bijections, 16 exact source hashes, no unrelated debt. Baseline metadata retained. |
| RP03 | Same Stage B, but transition exists only in candidate branch and original released base is selected. | FAIL: no trusted admission; adding a local candidate artifact cannot authorize itself. |
| RP04 | Stage A tree accidentally includes any feature source or changed baseline. Verify Stage A tree invariant. | FAIL before declaring Stage A ready; exact released source/baseline required. |
| RP05 | Valid pair table; change one policy-relevant literal/leaf in candidate. | FAIL even if aggregate row count is unchanged; safe source/leaf mismatch and correction reported. |
| RP06 | Valid pair table; change surrounding scope/control flow while keeping printed leaf identical. | FAIL source SHA binding; no same-leaf-only admission. |
| RP07 | Change rule, file or pair occurrence count independently. | Each FAIL; no reclassification, relocation or count growth admitted. |
| RP08 | Swap old/new identities, duplicate old, duplicate new, collision with unchanged row, omit one pair or add one pair. | Each FAIL; exact bijection and exact 102 scope enforced. |
| RP09 | Preserve aggregate 6,823 while adding unrelated debt and removing unrelated baseline row. | FAIL both changes; totals cannot mask substitution. |
| RP10 | Change baseline reason, owner or remediation for a remapped row. | Each FAIL; unchanged metadata required. |
| RP11 | Alter any of 16 old or new source hashes; use wrong base commit or tamper with frozen source bytes. | Each FAIL before admission; no automatic hash refresh. |
| RP12 | Supply a seventeenth file, a 103rd pair or an unapproved rule, including a seemingly benign identical leaf. | Each FAIL; no global expansion implied by schema support. |
| RP13 | Candidate tries to replace trusted manifest, or trusted base cannot be read/verified. | FAIL closed; no working-tree fallback or inference from current main. |
| RP14 | Valid artifact at existing byte limit; same valid content one byte over, malformed/truncated JSON, unknown fields or invalid hashes. | Within-limit valid fixture accepted by schema; over-limit/malformed variants FAIL; no limit increase. |
| RP15 | Source or artifact is symlink/nonregular, missing, oversized, exceeds aggregate read budget, or helper exceeds existing timeout. | Each FAIL closed; existing filesystem/read/time protections retained. |
| RP16 | Existing historical approved header-context transition fixture, then its signature/symbol/count tampered. | Prior valid fixture remains GREEN; tampered variants FAIL as before. |
| RP17 | Valid record but printed leaf/proof digest tampered; repeated identical leaves with changed cardinality/order binding. | FAIL where exact binding changes. Untampered repeated-leaf approved fixture remains GREEN. |
| RP18 | Local Stage A/B run passes. Inspect report and release checklist. | Clearly local evidence only; public-trust and UAT remain pending. No public release readiness asserted. |
| RP19 | Stage A later merged publicly; Stage B rebased without source drift; check against actual verified trusted merge base. | Public trust boundary verified independently; checker may pass only exact scope, with build/regressions and owner UAT still separate. No test performs a push/merge/deploy. |
| RP20 | Run full checker on Stage A unchanged released source/baseline. | Existing baseline passes; future manifest grants nothing to unlisted source. No runtime authority changes. |

## Narrow execution sequence and evidence

1. Capture approved proof digest, released base identity, source/baseline equality and clean separation of worktrees. Record Docker image and exact command without secrets.
2. Create acceptance tests and establish RP01 plus causal negative admission tests before validator implementation. Keep failure logs per scenario.
3. Implement Stage A locally; run validator regression and matrix. Verify runtime source and baseline remain byte-for-byte released. Commit only the reviewed policy package locally. Record full commit/tree hash.
4. In isolated Stage B, integrate Stage A locally through reviewed Git ancestry, retaining exact frozen source bytes. Remap only approved baseline identities/metadata. Run checker against the explicit local Stage A commit; retain report as LOCAL_SIMULATION.
5. Run focused build and publication-preservation regressions on the feature. Record scenario-level TRUN with RED cause, GREEN result, actual totals and limitations. Do not infer publication/UAT from policy success.
6. Handoff exact Stage A and Stage B diffs/commits for separate public authorization/review. A future public Stage A merge must be verified and Stage B rerun against the actual merged trusted base. A local commit hash is never substituted silently for that public trust check.

## Human review and release gate

Owner review checks that the reports explain why old findings moved and how drift is rejected; independent reviewer checks exact source diffs, unchanged task authority and preserved manual-fact custody. The policy transition is not acceptance of the existing task-specific debt, and does not complete product UAT. No production credentials, providers, migration, activation, sends, attempt resets or history rewriting are involved in these tests.
