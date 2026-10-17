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
