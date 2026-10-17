# Reviewed transition proposal — diagnostic and review receipt

2026-10-17. Source baseline `190621a53536cdd04c7c3ed7e449f9313b8d5364`.
Status: proposed policy/test packet, not approved LOCK or implemented behavior.
The operator boundary is developer/CI baseline enforcement, not publication.

Files delivered:

- `docs/tdpd/runtime-policy-reviewed-transition-proposal.md`
- `tests/tdpd/runtime-policy-transition.proposed.cjs`

The existing gate/scanner, approved baseline, workflow and application source are
unchanged. No real transition artifact or per-business exception is installed.
The explicit `.proposed.cjs` command is a diagnostic proposal, outside the current
accepted CI list. Its failures are recorded, not skipped, suppressed or represented
as acceptance GREEN. Human specification approval remains pending.

## TRUN: Tower containers only

Source-only snapshot:
`/home/innokenty/projects/contentops-ratchet-proposal-190621a`.
Compose project `planner-ratchet-proposal-190621a`, existing reviewed
`ops/quality/compose.yaml`, image `planner-policy-quality:node24`. Non-root,
network none, read-only source/root, dropped capabilities, no-new-privileges,
2 GiB/2 CPU/256 PID limits and temporary storage. Synthetic Git fixtures are
created inside container `/tmp` and removed by test cleanup. No project code
runs on the Tower host. No DB, browser, credentials or provider are used.

Final diagnostic command:
`node --test --test-concurrency=1 tests/tdpd/runtime-policy-transition.proposed.cjs`.
Observed17 October13:57 UTC: **31 executed,27 passed,4 failed,0 skipped**, exit1.
The four expected gaps are local reviewed-transition admission (R1), missing
trusted base rejection (R4) and reviewed PR/push event admission (two R17 cases).
R1/R17 fail with `BASELINE_WIDENED`; R4 observes current admission without a base.
These are behavior gaps in the proposed contract, not container setup failures.

Earlier proposal iterations ran12 tests (10 pass/2 expected fail) and16 tests
(14 pass/2 expected fail) before the independent review expanded and corrected
the adversarial matrix. None of these runs imported application code.

Existing accepted scanner/gate tests:
`node --test --test-concurrency=1 tests/tdpd/runtime-policy-collector.test.cjs tests/tdpd/runtime-policy-gate.test.cjs`:
**36 passed,0 failed,0 skipped**, exit0.

`RUNTIME_POLICY_BASE_REF=190621a53536cdd04c7c3ed7e449f9313b8d5364 npm run quality:gate`:
**PASS**, score77/minimum77, findings7096/baseline7096, no hard stops.
The proposed tests do not make PR172's distinct changed runtime baseline pass.

No application build rerun is claimed for this specification/test-only branch:
there are no changes to compiled application source or build inputs. The proposed
JavaScript test module executed successfully; existing checks remain required for
the eventual implementation.

Saved raw outputs on the operator Mac:
`/tmp/runtime-policy-transition-final.log`,
`/tmp/runtime-policy-proposal-existing-tests.log`,
`/tmp/runtime-policy-proposal-quality-final.log`.

## Independent review and closure

Reviewer `/root/dzen_runtime_review_retry`, static review only, with no code
changes or new test execution. Final verdict: proposal/tests PASS, no open P1/P2.

- P1 trusted-ref order: closed by exact PR/push mapping, conflicting override
  rejection, full nonzero SHA, absent/dispatch/symbolic-base prohibition and
  required event-base wiring for every quality step, including the Dzen job.
- P2 measurable limits: closed at packet level with strict keys and exact byte,
  count, subprocess and shared-deadline limits. Remaining implementation-stage
  size/mode/missing-object/deadline scenarios are explicitly mandatory before GREEN.
- P2 laundering fixture: closed with unchanged signature, exact source hashes,
  task_identifier-only remap and a distinct non-remappable business comparison.
  Owner/reason/remediation each have a preservation case.
- Follow-up P2 fixture quality: closed by clearing CI discriminator variables,
  oversized otherwise-valid JSON whitespace, and a valid JSON Git blob recorded
  as mode120000 to isolate trusted-artifact mode checking.

Reviewed SHA256 values, independently confirmed locally:

- Packet: `674f01d945629902fa8defb4d4a255ef6d8ea3bff7b73448b668aefe75728722`
- Tests: `e83e1aad603480d3c4da9ec205107f65402da889f5e9a72289bb17123c4d91ab`

Review covers proposal/test quality, not implementation/admission or human UAT.
Before dependent implementation obtain the exact LOCK/QAR/ARCH/RISK verdict for
the additional trusted transition input. Approval of that mechanism will not
itself approve the real PR172 mapping; its artifact must receive separate exact
source review in the trusted base before consumption. No merge, deploy, live
operation or publication fact is authorized by this packet.
