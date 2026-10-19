# Governed Dzen and VK owned-publication route

Owner rule: 2026-10-13, verified in Portfolio HQ user turn
`01a1354f-36ec-7562-a124-e369cc491ab8`. This file is the single operating source;
AGENTS, the operator guide, consumer bootstrap and role bootstrap reference it.
Owner-approved Dzen extension: Ops handoff from
`01a0c579-1ac5-7011-b7be-a99fd03cda8b`, 2026-10-13. The legacy filename stays
canonical; do not create a second route policy.

## Required route

Documented Planner command -> registered independent Dzen or VK adapter/consumer ->
adapter-owned browser/session. Every governed owned-publication control action,
execution and read-only preflight follows that route. No Codex role opens Dzen or VK with
CUA/cua.getTab/ComputerUse, personal browser tabs, CDP or session injection, even
for login checks, developer diagnostics or UAT. Failed/unavailable adapter means
BLOCKED + engineering repair. It never selects Codex browser or alternate API,
worker, browser, manual or chat fallback. A denial on a site/action remains binding
in another adapter/process/agent; offline tests never grant live permission.

The operating route marker `planner_registered_independent_adapter` is an
identity check only. It grants no permission, registration health, session rights,
release, absence evidence or publication fact. Existing explicit site/action
denials remain applicable and are not cleared by owner approval or architecture.
UNKNOWN/started/uncertain outcomes allow reconciliation only, never resend.

## Commands and owning state

Dzen #1002 remains project10/channel116/accepted revision3/decision300/asset151.
Its documented read-only entry is `ba_preflight_dzen_task1002`; missing readiness
requires adapter development, never CUA or manual publication. An observed
HTTP200 response does not prove exhaustive inventory. Both native collections
must be checked and unknown pagination remains BLOCKED. This policy grants no
release, send, retry, session or publication-fact authority.

The pilot remains project10/task1048/channel117/community-240051152, accepted
revision1/asset130/feed, the existing release and job
`3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de`. No new task, job, credential or session is
created by this rule. Follow `docs/tdpd/017-vk1048-provider-operator.md` and
`docs/operations/vk-connector-consumer-bootstrap.md` for the existing protected
Planner commands and human operator entry. All hash/generation/lease/attempt/fact
checks remain mandatory; existing WI1699 and audit history are preserved.

Planner receipt, host heartbeat and a written pending request prove control-plane
activity only. Record automatic success only from validated provider evidence
and the canonical fact/permalink. A human manual observation is reported with
its collection mode and does not itself manufacture a connector publication fact.

## Enforcement and limits

The generic publication dispatcher must not use its direct VK transport or create
generic browser work as fallback. It returns the fixed adapter requirement before
provider calls, task changes or browser work-item upserts. Low-level provider
transport implementations are not a governed task dispatch route. Production
provider runtime checks the route before admission/control/profile operations.
All Dzen/VK-connected role bootstraps carry this same instruction. Dzen central
browser fallback is blocked before generic browser work-item/state writes.
This does not claim every legacy Dzen transport has adapter registration/admission
guards; task-native preflight/release guards remain separate. Provider denial is
not resolved by this change.

Regression checks cover wrong production route, absence of CUA/CDP dependencies
and calls in the provider graph, no generic fallback/write on failed or stale VK
publication, exact package/fencing, and uncertainty/no-retry. They do not disable
Codex's global tool inventory or prove that every future agent will obey a prose
rule. Written policy, application guards, tests, deployed revision and owner UAT
are reported separately. Live VK selectors/session/media and UAT remain unverified;
this rule authorizes no provider run.

## Legacy binding race boundary

Legacy posts use a scoped effective-channel resolver before selection and again
before provider handling. Missing/foreign explicit bindings never choose another
channel. VK/unknown bindings are held without fallback or automatic reset.
Legacy batch claiming is not the canonical017 serializable generation/lease
fence: a channel may disappear after a previously valid non-VK batch claim. That
case retains the claim for repair and performs no default lookup, send or reset.
Do not report that legacy path as race-atomic zero writes. The017 job and its
canonical immutable-package/lease checks remain separate and unchanged.

## Publisher runbook / HANDOFF

Report the documented command, task/revision/asset binding, adapter readiness
and exact sanitized blocker separately from heartbeat, permission and provider
success. On failure keep the owning task held and route the defect to development.
For Dzen #1002, dry-run `readiness_diagnostics.basis=stored_preflight_proof`
describes durable proof, not a fresh cookie/provider check. Missing/expired proof
or incomplete inventory must not be called a cookie failure. Current native
evidence has unknown end-of-list; draft count previously read from publications
was not proof that drafts were empty.

Bootstrap changes affect manifest checksums. Preserve pinned task1002 approval:
do not silently rebind its checksum or release/send; report STALE_MANIFEST to
the owner if encountered. No live verification is authorized by this handoff.
After deployment and only when the affected readonly action is permitted, the
owning p10 Publisher can inspect current metadata/checksum and run the documented
preflight once to retain collection counts and explicit provider paging evidence.
Do not run it to bypass a denial. VK #1048 remains blocked pending permitted
operator admission; its existing job, generation, release and facts are intact.

## Generic Dzen source lifecycle

The owner-approved independent adapter implementation is described in
[owned-dzen-adapter-lifecycle.md](owned-dzen-adapter-lifecycle.md). It extends the
existing task command with stored-only preview, exact release and original-attempt
reconciliation. Source availability does not supersede this mandatory route or
clear any denial. Deployment, real readiness and owner UAT remain separate gates.
