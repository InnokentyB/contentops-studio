# Runtime policy no-new-debt check

Approved contract: `../tdpd/runtime-policy-no-new-debt-contract.md`.
Audit/backlog: `runtime-policy-audit-2026-10-16.md`.

Run `npm run quality:runtime-policy` or `npm run quality:gate` from repository
root after installing existing dependencies. On tower use the reviewed isolated
container commands in `../../ops/quality/README.md`; no native project execution.
Tracked plus non-ignored untracked source is checked, so new files cannot hide
until staging. No application module is imported/executed by the scanner.

The check detects task-numbered symbols/modules/tools/routes, literal business
bindings/schema values/record lookups, fixed package actor/digest/date references,
task comparisons/switch cases/allowlists/dispatch maps, and bounded config/SQL/
script forms. Protocol numbers/dimensions and ordinary x1/x2 variables are not
globally banned. Isolated tests/fixtures/seeds/history are not production debt;
literal runtime imports promote source fixtures/history into operational scope.
Compiler JSONC is supported; JSON/YAML/JS/TS parsing failures fail closed.

Failures show file/line/rule and a statement-context hash, never source text or
secret values. The baseline admits only exact file/rule/fingerprint/count rows,
each with reason, proposed owner and removal plan. Changing an existing bounded
statement or adding another occurrence produces new debt identities. Only the
previously reviewed exact context transition below can replace an identity;
ordinary business-binding growth remains forbidden. Removing debt requires
pruning its baseline rows/counts, so an old permission cannot resurrect it later.
Do not regenerate or widen the baseline to make an ordinary publication pass.
The CLI offers inspection (`node scripts/check_runtime_policy.cjs --inspect`),
not an auto-accept/update command. Inspection is not enforcement or authority.

CI supplies `RUNTIME_POLICY_BASE_REF` from its trusted PR/push event. The baseline
cannot grow against that base except for exact source-bound replacements already
reviewed there. Initial installation has one explicitly reviewed
bootstrap parent, documented in the audit; missing/invalid subsequent trusted
baselines fail. Local comparison can use `--base-ref <trusted-commit-sha>`.
The policy gate is bounded to15s by the parent quality gate, with failure closed.

Limits: this is static syntax/context detection, not semantic proof, a full SQL/
shell interpreter or publication permission. Computed names, non-import loaders,
neutral aliases and indirect executable fixture references still require review.
Reviewed CI/scanner/baseline changes remain trusted code and require human review;
branch-protection administration was not audited or changed by this work.

## Exact reviewed context transitions

The owner approved `../tdpd/runtime-policy-reviewed-transition-proposal.md` on
17 October2026; direct source and exclusions are recorded in
`../evidence/runtime-policy-transition-owner-approval-2026-10-17.json`. Its
implementation adds no real publication exception and grants no merge/deploy,
provider permission or automatic PR172 admission.

Only a strict record already present at
`docs/code-quality/runtime-policy-transitions.json` in the trusted CI base can
admit replacements. Current-branch records never authorize themselves. Records
pin complete old/new JS/TS source hashes and one-to-one task_identifier context
hashes. Symbol, function declaration signature, counts, owner/reason/remediation
must remain unchanged; all other rule kinds keep their original exact comparison.
Sources/records must be regular files, and all active source sizes/hashes are
checked before AST contexts. Existing scanner fingerprints are unchanged.

GitHub Actions requires a nonzero full event-derived base for enforcement,
independent of whether the current branch contains a record. PR uses base.sha;
push uses before. Missing base, workflow_dispatch or a conflicting CLI override
cannot issue PASS. Use `--inspect` for manual diagnostic output, not admission.
Local enforcement without explicit base compares baseline growth with HEAD only
to require an explicit comparison; HEAD never admits transitions. Uncommitted
repositories retain legacy local diagnostics, which are not trusted CI evidence.

Limits: record64KiB,8 files/256 remaps (64 per file); source1MiB each and8MiB
aggregate;32 Git reads,1s each, sharing2s for transition I/O/comparison. Reads
receive decreasing remaining time. Modes, malformed/schema/size/deadline/errors
fail closed with sanitized codes. No source or Git stderr is printed.

Two-stage delivery requires separate exact review: first stage the source-bound
record while old code/baseline remain unchanged; only a subsequent PR consumes
that record from its trusted base, removing old baseline identities. Never copy
an evidence candidate into this path as an approval shortcut. After debt pruning,
its old rows are absent and a stale record cannot resurrect them. Applied old/new
hash/count pairs appear in the gate report; baseline writes remain manual and
reviewed. No record or baseline auto-generation/update command exists.

## Exact preservation pack

The Owner approved the separate TDPD026 preservation proposal for local tests
and implementation on 20 October 2026. This does not authorize public staging,
deployment or publication. The original transition format above remains strict.

The separate `docs/code-quality/runtime-policy-preservations.json` format binds
review metadata, complete old/new source hashes, and individual old/new finding
identities with exact printed-leaf SHA256 and occurrence counts. Its limits are
16 files, 102 pairs and 64 pairs per file; the approved pack contains exactly
16 files, 102 pairs and 110 occurrences. Only `task_identifier`,
`business_binding`, `business_record_lookup` and `business_comparison` are
eligible. A filename, provider or rule name alone never admits a finding.

The record is read only from the trusted event/comparison commit. A current
branch record cannot authorize itself. Any active preservation consumes the
whole reviewed pack: source hashes, leaf syntax, named lexical scopes, baseline
ownership/remediation and counts must match. Missing pairs, collisions, partial
replacement or unrelated baseline edits fail closed. Anonymous transaction
callbacks may enclose the same leaf; changing its named callable binding cannot
inherit approval. Scanner identities are unchanged.

Both transition formats share the existing 32 Git reads and two-second budget.
Batch mode checks and cached source reads keep the maximum combined 24 source
files within that read budget. Existing one-second per-read, 64 KiB artifact,
1 MiB per-source and 8 MiB aggregate source limits remain. Git/source/parse
errors are sanitized; no source excerpts or private payloads are printed.

Delivery remains two-stage: first merge a separately authorized policy-only
change with product sources/baseline unchanged; then consume that record in a
feature PR based on the merged trusted commit. A local simulation with a local
Stage A commit proves local behavior only and cannot claim public CI admission.
