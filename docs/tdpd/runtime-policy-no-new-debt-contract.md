# RUNTIME-POLICY-NO-NEW-DEBT-001 — minimal decision packet

Status: human-approved exact LOCK/QAR/ARCH/RISK, 16 October 2026. No publication
runtime or production data mutation is included. Approval is not owner UAT.

## LOCK

Actor: developer/CI reviewer. Outcome: a new concrete publication does not add a
task-specific production function/module/route/tool/schema/dispatch branch.
Apply a static no-new-debt check to tracked backend, frontend, workers, scripts,
configuration and schemas. Existing findings receive individual classified
baseline entries with reason, remediation owner/backlog and occurrence count;
no blanket path/provider exemption. Tests/fixtures/seeds/historical migration
data are classified separately, not production authority. Never remove real
security controls. Ordinary numeric protocol constants and limits remain valid.

## QAR

Offline/deterministic; no DB, provider, credentials or browser. Scan all tracked
in-scope source in at most15s after existing dependencies are installed. New
unbaselined findings fail with file/line/rule; unchanged debt passes, a duplicate
or broadened debt entry fails. Parsing/baseline/schema errors fail closed. Tests
prove positive/negative cases, baseline count, malformed baseline, role/data
literal versus ordinary numeric values, added files and CI integration.

## ARCH

Use existing TypeScript parser for JS/TS AST and small explicit handlers for
configuration/schema text. A reusable scanner emits findings; a CLI compares
them to an exact baseline and is called by the existing quality gate. Install
existing dependencies in the audit CI job if required; no new runtime library,
service, deployment, endpoint or permission. Static findings are candidate
policy violations, not a complete semantic proof; the full audit remains a
separate reviewed artifact with import/reachability analysis and explicit gaps.

## RISK / compatibility / rollback

False positives: classify by syntax/context and exact reviewed exceptions,
never prohibit all digits. False negatives: document supported forms, run
adversarial fixtures and require semantic review for renamed/computed bindings.
No code execution while scanning; no env/config secrets or generated dependency
trees read. Baseline changes remain reviewable, not automatically accepted by
the gate. Existing operational controls and old history remain untouched.
Rollback removes only this developer gate/CI wiring; production authority is
unchanged. Do not deploy or mass-refactor as part of this packet.

Human exact verdict: **«Утверждаю»**, verified directly with `read_thread` in
Portfolio OS `01a0df21-ea6c-71f2-9c1b-40393de0e105`, user message
`01a14652-d577-7cd1-85b5-ced912f483e5`, questionItemId
`["request_user_input_async","call_f923a7e26b1f411eb685c5890db8934f",0]`.
The question explicitly approved CI blocking new publication-number-specific
functions, commands and branches, with individually classified existing debt,
offline and without publication mutations. No deploy authority was requested.
