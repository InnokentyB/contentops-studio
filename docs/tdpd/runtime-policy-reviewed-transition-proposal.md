# RUNTIME-POLICY-REVIEWED-TRANSITION-001 — exact decision packet

Status: proposed LOCK/QAR/ARCH/RISK delta; human verdict pending. Source baseline
`190621a53536cdd04c7c3ed7e449f9313b8d5364`. This branch contains proposed tests and
specification only. No scanner/gate/baseline/CI implementation is changed.

## Concrete problem and material difference

Approved `runtime-policy-no-new-debt-contract.md` requires unchanged debt to pass,
new/broadened/duplicated debt to fail and exact baseline exceptions to remain
reviewable. The installed gate binds a task-named function declaration to its
entire normalized body. Removing sandbox-disabling arguments changes six
`task_identifier` hashes without changing the authority symbols or bindings.
Independent PR172 review confirmed exactly six removed/added fingerprints and
7096 total findings before/after; no other findings changed.

Today `check_runtime_policy.cjs` permits baseline rows only if the exact identity
already exists in the trusted base. Replacing those six rows would therefore
fail `BASELINE_WIDENED`. Equal finding counts cannot prove unchanged authority.

The proposed material difference is one narrowly scoped additional trusted
input: an exact source-bound transition already reviewed in the CI trusted base.
This changes how the developer gate admits baseline replacements. It is an
architecture/security delta even though it has no production publication API.
The original packet did not approve its schema, trust ordering or replay rules.
Dependent implementation requires an exact human verdict; drafting executable
proposed regressions does not represent approval or final acceptance scenarios.

## LOCK: observable result

Actor: code reviewer and CI. A previously reviewed source correction may replace
only its exact existing task-identifier context fingerprints. New task-specific
symbols, business bindings, expanded comparisons, duplicates and retired debt
remain rejected. No automatic baseline generation/update, count-based admission,
file/provider exemption, CLI permission flag or changed publication authority.

The current branch cannot authorize its own transition. The approval artifact
must already exist in the trusted base supplied by the CI event, independently
reviewed before the source/baseline replacement. A working-tree artifact is
never sufficient. The gate continues scanning and enforcing every other finding.

## ARCH: proposed minimal mechanism

Use the existing scanner, CLI and trusted Git base. No new service, dependencies,
runtime environment variable, publication command, credential or database.

Proposed fixed artifact path:
`docs/code-quality/runtime-policy-transitions.json`, strict schema version1.
Each reviewed entry contains one file, full old/new source SHA256 values,
one-to-one remaps (`rule`, `oldIdentity`, `newIdentity`, `count`, `symbol`) and
review reference/owner/reason/removal plan. The tests contain synthetic entries;
this branch installs no real approval artifact or Dzen exception.

Strict allowed keys are exactly those exercised by the proposed fixture:
root `schemaVersion,entries`; entry `file,oldSourceSha256,newSourceSha256,remaps,review`;
remap `rule,oldIdentity,newIdentity,count,symbol`; review
`reference,owner,reason,removalPlan`. All fields are required; unknown fields,
duplicate file entries, duplicate old/new remap identities, nonpositive or
unsafe counts and ambiguous mappings fail. Digests are lowercase64hex. File
paths are repository-relative regular files only: no absolute path, traversal,
backslash or Git symlink/submodule mode. Review strings are4–2000 characters;
identifier symbols are at most200 characters and must match the actual parsed
old/new symbol. No artifact field may choose another artifact or baseline path.

Read artifact content only with `git show <trusted-base>:<fixed-path>`, with
bounded bytes/time and sanitized failure codes. Never fall back to the current
checkout, arbitrary path, missing base or missing trusted artifact when a remap
is requested. Existing unchanged debt without a remap keeps its present behavior.
The local diagnostic path must require `--base-ref` for transition use; CI keeps
its existing event-derived `RUNTIME_POLICY_BASE_REF`, with no caller substitution.

For transition consumption require a full nonzero40hex commit SHA. In GitHub
Actions require the event-bound environment value: pull_request uses
`github.event.pull_request.base.sha`, push uses `github.event.before`; missing,
zero, unavailable revisions and workflow_dispatch cannot consume transitions.
If CLI and environment values are both present they must be identical; reject
conflicts rather than choosing either silently. `HEAD`, abbreviated revisions,
the working tree and the current PR head are never fallback authority for a
transition. Outside CI, an explicit full `--base-ref` supports a local diagnostic
only and does not establish human approval. Unchanged debt without a consumed
transition retains existing local compatibility, including its current CLI.

Every workflow step that invokes quality:gate must receive the same event base,
including the Dzen job (currently only the final main quality job wires it).
Implement this wiring alongside the approved mechanism, preserving every
existing check/job. Tests isolate their synthetic Git base from the runner's
real repository environment. No new operator-supplied CI input is proposed.

For each replacement require all of the following:

- The old file bytes and old baseline entry exist in the trusted base; source
  hashes match exactly before and after, with no symlink/path traversal.
- Only `task_identifier` context identities may be remapped initially. Module,
  route/tool, digest/date/actor, business lookup/binding/comparison/dispatch and
  configuration rules remain non-remappable. This is a generic rule-kind bound,
  not a task/provider/file exception.
- The identifier symbol, declaration kind/signature, file and occurrence count
  are unchanged; the mapping is unique and one-to-one. A new symbol or a renamed
  function cannot inherit the old allowance. Other scanner findings still pass
  their exact existing no-new-debt comparison.
- Current baseline removes the old identity and includes only the exact approved
  replacement with identical count, owner, reason and remediation. No duplicate,
  increased count, extra row or stale old permission is admitted.
- Current source and baseline match the transition, and every old row still
  exists at this trusted base. A later base where debt was pruned cannot replay
  a previously reviewed transition to restore it. Pending unused transitions do
  not change unchanged baseline/source admission.

Do not weaken statement hashing or make all bodies of an existing task function
admissible. The artifact authorizes only one exact reviewed before/after file
pair. Semantic source review remains necessary: syntax detection is not proof
that arbitrary code preserves authority. This work does not solve existing
indirect/computed-binding limitations or grant a new blanket exception for them.

Keep baseline pruning available for actual debt removal. Rejected/malformed/
ambiguous transitions fail closed without source/secret excerpts. Report applied
transition identities/counts in the existing JSON report for reviewer audit.

## QAR and proposed regression matrix

Retain the15s parent quality-gate bound and offline deterministic operation. No
application import/execution, environment secret reads, provider, DB or browser.
No reinstallation or persistent test service is needed. Tests use existing
Node test/Git/TypeScript infrastructure inside temporary Tower containers.

Exact proposed limits: artifact64 KiB; at most8 distinct source files, at most64
remaps per file and256 total; each old/new source at most1 MiB,8 MiB total source
bytes across both sides; at most32 metadata/blob Git subprocesses, each at most
1s and1 MiB stdout. Artifact stdout is capped at64 KiB. All transition I/O and
comparison share a2s deadline inside the existing15s parent budget; each child
receives only the remaining deadline, never a fresh independent timeout. Missing
budget, truncated output, timeout, invalid mode and oversized input fail with
bounded sanitized error codes. Do not print source, Git stderr or review text.
These limits are for transition admission only; existing scanner input coverage
and baseline bounds may not be reduced to make this feature pass.

`tests/tdpd/runtime-policy-transition.proposed.cjs` is explicitly invoked, outside
the default CI acceptance test list while this decision remains pending. Its
fixture represents a synthetic named provider function, never an operational
publication task. Positive cases require an exact pre-reviewed transition and
unchanged pending debt to pass. Negative cases cover self-authorization, missing
trusted base, extra source/task edits, duplication, expanded task comparisons,
changed business-binding values, stale old allowance, old-source mismatch,
changed baseline owner/remediation and resurrection after pruning.

The executable proposal also covers conflicting CLI/event refs, matching PR/push
refs, symbolic/zero refs, symbol renames, unknown fields, duplicate old/new
mapping destinations, duplicate file entries, artifact traversal/symlink mode,
artifact size and current-branch tampering. The laundering case keeps the same
signature and exact source hashes, maps only task_identifier and adds a distinct
business-comparison finding, which must remain rejected as BASELINE_WIDENED.
Owner, reason and remediation each have a separate preservation case.

Before implementation, finalize remaining source-size, source-mode, missing
object and deadline-exhaustion injection cases at the approved public gate
boundary. Existing gate tests remain required, including new untracked files,
promoted fixtures, malformed baseline/source, missing trusted revisions and
baseline growth. No assertion or existing CI step may be deleted or skipped to
obtain green. A passing negative case before implementation is not proof of the
new mechanism: the existing blanket rejection also rejects it.

## RISK, review, compatibility and rollback

Primary risk is baseline laundering by a branch that supplies both new code and
its own remap. Requiring a pre-existing trusted artifact and exact source hashes
separates authorization from consumption. New business authority must continue to
fail even if aggregate counts match. A stale artifact cannot recreate a removed
baseline row; missing/ambiguous evidence never becomes permission.

Trust order is deliberately two-stage: first review the generic mechanism and
then an exact future transition artifact while baseline/source are unchanged;
only a later PR consumes that trusted artifact. Do not replace this with a
self-admitted PR manifest or a synthetic approver marker. Trusted repository
policy remains subject to human review, as with the existing scanner and CI.

Rollback retains the previous gate and baseline unchanged. If a transition has
already been consumed, reverting only the mechanism makes those rows fail;
restore the corresponding exact old source/baseline pair or keep the reviewed
mechanism until the debt is retired. Never widen a baseline to make rollback
appear green. No database or production data migration is involved.

Independent review must challenge trust ordering, symbol/source binding,
pruning/replay and negative-case coverage. Approval covers implementation/tests
of this developer control only, not admission of PR172, merging, deploying,
provider-policy clearance or owner UAT.
