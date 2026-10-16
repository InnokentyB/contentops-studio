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
statement or adding another occurrence is new debt. Removing debt requires
pruning its baseline rows/counts, so an old permission cannot resurrect it later.
Do not regenerate or widen the baseline to make an ordinary publication pass.
The CLI offers inspection (`node scripts/check_runtime_policy.cjs --inspect`),
not an auto-accept/update command. Inspection is not enforcement or authority.

CI supplies `RUNTIME_POLICY_BASE_REF` from its trusted PR/push event. The baseline
cannot grow against that base. Initial installation has one explicitly reviewed
bootstrap parent, documented in the audit; missing/invalid subsequent trusted
baselines fail. Local comparison can use `--base-ref <trusted-commit-sha>`.
The policy gate is bounded to15s by the parent quality gate, with failure closed.

Limits: this is static syntax/context detection, not semantic proof, a full SQL/
shell interpreter or publication permission. Computed names, non-import loaders,
neutral aliases and indirect executable fixture references still require review.
Reviewed CI/scanner/baseline changes remain trusted code and require human review;
branch-protection administration was not audited or changed by this work.
