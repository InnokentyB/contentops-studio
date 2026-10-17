# Context-quality pilot checkpoint — 2026-10-17

Authority: owner requested three layers on the existing Planner audit/CI slice,
an observable checkpoint → simulated resume → restore → violation → separate
review walkthrough, then a proposed canonical TDPD handoff. No forced compaction,
live skill/framework edits, portfolio rollout or publication changes in pilot.

## Checkpoint before simulated resume

- Audit commit `5c2db507b096bdafd7afe84c46b135e36ae8ece5`;
  tree `9ea85c9ac3f80b1e9aaa0fe63a47a65fc13c7442`; PR166.
- AGENTS SHA256 `3c39aa7dbe127307a27c9dccadca2e56574be8856360d1edd4b28257338f5c06`;
  .agents/AGENTS `d98e8ee8146fd329627635ae497223e8076c1a1e69e7ae95fa65bc7978d32b81`.
- Portfolio standard v1.0, 2026-09-25, SHA256
  `deac96eed63b762d6b2941b16796d8f22b2875de962240f20c04832b4156cc3a`.
- Installed TDPD v0.13.0 commit `2f5c87c`; FRAMEWORK SHA256
  `d6a8fed41e986b2cdafb6490cc6ab7a68cc7e48c3f9c6c7deb453d8201cbb6fb`;
  QUICKSTART `8c0965c8b94364fc592807cc4760d975023d243249e956468006fc21350003a0`.
- Approved audit slice contract SHA256
  `1d65512e1de0b4ac3525b6641c0b39091f73c710a34e4cdc2ca715ca40a2a07a`.
- Parent quality command SHA256
  `fb812f49ff3e1d27f159f5a5243961c231499321341342a3606fd1f70858e435`;
  runtime gate `833087f77619bf4e4ec462002d9d59bab57fc8cce1a29044f7b6cc1647553267`.

Interpretation: existing publication-specific runtime debt is preserved and
individually baselined, not permission to add another task-numbered route.
Production authority, tenant checks, audit, idempotency and uncertain-outcome
guards remain. This pilot has no provider access; test workloads stay in the
existing isolated network-none Docker service on tower. Existing 17 runtime
findings are still open; CI prevention is not their repair. A separate approved
004 implementation must stay out of this pilot commit.

Outstanding: simulated-resume evidence, fresh gates/build, independent review,
owner UAT. Same agent retains history; no controllable compaction hook has been
verified. Do not represent this walkthrough as real context erasure/reinjection.

## Observed walkthrough and verification

Manual simulated resume: after saving the checkpoint, the main actor re-read
the checkpoint, protocol, both AGENTS files, FRAMEWORK/QUICKSTART and approved
audit contract, and compared the current standard already read in this run.
Interpretation above remains applicable; no production scope is gained. This
is a recorded human-readable interpretation, not proof of cognition or loss
of the earlier conversation. No instruction drift was observed in that set.

Executable inputs: staged tree `c9326a7011f6c9d4147d5e73c2b88584d8577275`;
the isolated committed tower copy and copied temporary tree matched exactly.
`quality` image `sha256:ec136a36fe1fb43ff16f0e82189081553ae1435c25d93f139ec50027995ca99a`,
Node24.22.0, linux/amd64, network-none/read-only source, UID1000.

| Scenario | UTC observation 2026-10-17 | Result |
|---|---|---|
| Restored checkpoint, real parent quality command | 07:28:49.962–52.218 | PASS/exit0 |
| Inject never-executed task-numbered source into private copy | 07:28:52.218–54.444 | expected FAIL/exit1, runtime_policy_no_new_debt |
| Remove own fixture and rerun, original tree restored | 07:28:54.444–56.678 | PASS/exit0 |
| Ancestor symlink in synthetic private directory | same invocation | rejected before copying |
| Existing focused suite + large-baseline regression | same tested input tree | 36 PASS, 0 failed/skipped |
| Backend and frontend build in build-check Docker target | 07:27–29 | PASS; src/Prisma/frontend/package/build inputs unchanged by pilot |

The first harness attempt failed on read-only `git write-tree`; it now reads
`HEAD^{tree}` and requires a committed secret-free source snapshot. A second
run exposed a real gate defect: `git show` used the default 1MiB buffer for a
larger trusted baseline. A focused test reproduced RED
`TRUSTED_BASELINE_UNAVAILABLE/BASELINE_WIDENED`; the bounded 8MiB/5s read now
passes without changing baseline validation or fail-closed behaviour.

Separate reviewer `/root/dzen_boundary_slice_review` received the original
requirements and exact diff. First review of tree `5c5d7dbb…` found P2 ancestor
symlink copying; fixed with per-component/realpath checks and a negative case.
Recheck of exact `c9326a70…` closed it and found no new actionable P1/P2. Reviewer
did not edit or run native tests. Same-model/inherited-history correlation is
a limitation: this is separate-actor diff review, not model diversity or owner
acceptance. Later edits to this file only record evidence; executable input
hashes above refer to the frozen pre-evidence tree, not a fictional final tree.

Pilot engineering evidence is present; owner UAT and canonical-source adoption
remain open. Production findings from the original audit remain open too.

## Canonical handoff (proposed, not applied)

Source: `https://github.com/InnokentyB/tdpd-product-framework`, remote HEAD
`2f5c87c044e62563f0f28ea02b3006c822a8ea6f` verified read-only on 2026-10-17.
The local Product/tdpd-product-framework checkout is older (`29b0106`); do not
blindly edit it or any installed `.tdpd`/live skill copy.

Propose upstream changes against that canonical version:

- `core/RECOVERY.md`: explicit current-rule recovery/interpretation at slice,
  resume and completion; hash drift invokes impact review; hooks optional and
  manual fallback honest.
- `templates/handoff.md`: exact commit/tree, rule/source hashes, interpreted
  applicable constraints, decision provenance, next action and unresolved gaps.
- `core/AGENTIC_ASSURANCE.md`: three layers; machine gates test behaviour, not
  promises; independent reviewer gets original requirements/exact diff; record
  correlated-model limits and separate UAT.
- Add an example walkthrough labelled simulated when compaction is not actually
  exercised. Reuse project-native gates rather than mandate a universal runner.

Owning framework chat not verified yet; the source repository is verified.
This proposal is not upstream acceptance or rollout to other projects.
