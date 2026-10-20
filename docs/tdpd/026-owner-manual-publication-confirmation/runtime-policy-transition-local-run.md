# Runtime-policy preservation: local execution record

The Owner directly approved the linked LOCK/QAR/ARCH/RISK proposal in this engineering chat on 2026-10-20. Authorization covers local tests and implementation only. Public export, PR/merge/deploy, production confirmation records and provider operations remain outside this approval.

## Separate stages

Stage A is `/tmp/contentops-policy-transition-stage-a`, branch `codex/manual-preservation-policy-20261020`, starting from released commit `5b5bb0324d8f6b7003c0ca1fa2ca2e681c451c4b`. It contains only the developer-control validator, inert declarative review manifest, tests, CI wiring and review documentation. Product `src/`, scanner fingerprints and the publication-policy baseline remain unchanged.

The compact manifest is `docs/code-quality/runtime-policy-preservations.json`, 41,625 bytes, SHA256 `248552ac914646562474c04bd7cf0089d5b63bd048e2ef587ebbcc4fc6c37a4c`. It binds exactly 16 old/new source pairs, 102 policy identity replacements and 110 occurrences. No source contents or policy literals are admitted solely by a filename or rule class.

Stage B is the separate Owner manual publication feature. The frozen application implementation was locally saved as commit `97adb0e`; its backend/frontend/consumer build and publication-preservation evidence remain in the feature TRUN. A future local composition may use a local Stage A commit as an explicit comparison base to verify the complete 6,823-row gate. Such a result must be labeled **LOCAL_SIMULATION**, not public-base admission. The production base still has no preservation authorization until a separately authorized Stage A PR is reviewed and merged.

## Test evidence

1. CAUSAL RED against the actual frozen 16-file/102-pair comparison: actual CLI and synthetic Git repository failed specifically with `BASELINE_WIDENED`, while the source hashes, scanner output and test setup were valid. Two inert/self-authorization controls passed. Source log `/tmp/owner-manual-policy-preservation-red.log`.
2. First implementation validation admitted the actual exact pack under a synthetic trusted commit; all three controls passed. This is distinct from public-base authority. Existing v1 and resource regressions: 47 PASS. The initial combined invocation also exposed a test-only `/feature` mount dependency; that infrastructure failure is retained and is not counted as a policy defect or GREEN.
3. CI test infrastructure was made self-contained: deterministic 16-file/102-pair/110-occurrence source fixtures are generated and checked by the real scanner and CLI/Git. Explicit `PRESERVATION_FEATURE_ROOT` selects a separately identified actual-source case for local engineering verification. CI does not need a private checkout or an external `/feature` directory.

The entries below record subsequent final verification. The intermediate evidence above alone does not establish engineering completion or Owner UAT.

4. Additional causal findings were fixed without changing the approved manifest: moving a leaf to another named object-property callable previously passed, and unrelated unchanged baseline metadata could be modified while consuming the pack. Both now fail atomically. A missing pair previously left a partial diagnostic result despite a failing gate; the complete baseline bijection now rejects that pack before returning any applied result.
5. An intermediate actual-source run falsely rejected a three-occurrence class-anchored fingerprint spanning three methods. Diagnosis showed that the correct invariant is an exact multiset of scope/count bindings, not one common scope for every occurrence. The scope-multiset fix preserves both total count and every named scope; the reviewed source/manifest remain unchanged. Intermediate failures and diagnosis are retained in `runtime-policy-runs/`.
6. Final new checks: 36/36 PASS in self-contained CI mode without an external checkout; 37/37 PASS with the additional actual frozen 16-file/102-pair case. Existing v1/resource regressions: 47/47 PASS. All are Docker executions with no skips, provider calls or production access. Independent review found no remaining material issue.
7. Stage A mandatory `quality:gate`: PASS, score77/minimum77, 6,823 findings/6,823 baseline rows, no applied transitions. CLI syntax checks also PASS. `src/`, `runtime_policy_scanner.cjs` and `runtime-policy-baseline.json` remain byte-for-byte unchanged from the released base. Full CI matrix and Stage B simulation are recorded separately after their final runs.
8. The complete six-file CI policy command passed 126/126 scenarios, zero skips/cancellations, in 54.76 seconds in the reviewed offline Docker stack. This includes collector, gate, v1 transitions, resource/budget controls and all 36 self-contained preservation scenarios. Log: `runtime-policy-runs/owner-policy-all-ci-final.txt`. Retained run outputs use `.txt` so they remain reviewable source artifacts under the repository's existing log ignore policy.

## Final local composition — not public admission

Stage A local commit is `0e3ac05b4de6eec3ceb53eacae5b5278cd5c4bec`. The feature was rebased onto it as local commit `cb6b0c2fcef4324c20cd107b0791b5112b013d68`; application sources, frontend, schema and dependencies match the tested build05/source97adb0e byte-for-byte. Exactly102 baseline identity rows were then replaced, retaining the original serialization and every other field. The final local remap commit/tree is recorded in the durable operations checkpoint, outside the commit itself.

Full Stage B `quality:gate` against local Stage A: **PASS**, score77/minimum77, 6823 findings and baseline rows, 102 applied pairs in16 files,110 occurrences. Original released-base enforcement: **FAIL / BASELINE_WIDENED / appliedTransitions=[]**. Both reports were checked programmatically; see `runtime-policy-runs/stage-b-verification.json` and the adjoining positive/negative reports.

Independent review confirmed the code, limits, baseline preservation, source equivalence and public boundary. The authorized local implementation is verified. Public Stage A review/merge, fresh Stage B integration against the real merged public base, release permission and Owner UAT are still pending; this record grants none of them. No provider or production database operations were performed.
