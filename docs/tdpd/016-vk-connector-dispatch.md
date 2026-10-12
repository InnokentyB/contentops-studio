# Planner → standalone VK connector dispatch

Date: 2026-10-12. Status: APPROVED FOR INFRASTRUCTURE IMPLEMENTATION.
Decision bundle: LOCK-VK-016, QAR-VK-016, ARCH-VK-016, RISK-VK-016, AUT-VK-016.
Owner: Innokenty Bodrov. Repository: ContentOps Planner.

The owner authorized fixing the second adapter in Portfolio HQ human turn
`01a13167-d36e-7703-b1c6-8fe782108664`. That authorizes investigation and preparation
of this concrete change, but does not constitute approval of this new architecture.
Repository AGENTS.md requires human LOCK/QAR/ARCH/RISK approval before scenarios.
Owner approval: direct reply "Да" in the VK adapter chat on 2026-10-12, approving
LOCK/QAR/ARCH/RISK/AUT-VK-016 as the presented bundle. Final scenarios, RED,
infrastructure implementation and reviewed disabled-provider deployment are now
authorized. No provider permission, login, profile access or new credentials are
authorized by this approval. Human UAT remains a separate decision.

## Evidence baseline and contract conflict

- Production code: `655f91d3e54214ccbf6c6115ebc6b23f3406c7d7`, merged PR126.
- Source branch reviewed: `1d85d234c8f4d7fbc9dd580f8755797d9b9f008f` (same package).
- Registry v33: `f5928dc815f40b24b13f3927411037d5df92cab1e75d20f178758eddd925b98a`.
- Project10 manifest: `sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b`.
- Readiness and architecture observations:
  `../evidence/vk-task1048-readiness-2026-10-12.json` and
  `../evidence/vk-task1048-adapter-architecture-2026-10-12.json`.
- `src/workers/vk_browser_worker.ts` is a one-job CLI. It launches persistent
  Chrome itself. No queue-polling process or dispatch receiver exists in current code.
- `ba_release_approved_vk_browser_task` creates a work item;
  `ba_claim_vk_browser_publication` grants a lease. Neither launches the executable.
- Production app and MCP are healthy. Railway Worker/Scheduler are Python parser
  processes, not the VK executor. No VK executor was running locally at observation.
- Pre-sync `stash@{1}` contains `browser_connector_host.ts` and its documentation.
  Inspected read-only: it detects vk/x and calls their one-job CLIs. It has no
  consumer, heartbeat, dispatch receipt or provider reconciliation service.
  Preserve the stash; reconcile individual modules, never restore older providers.
- Approved ARCH-VK-015 explicitly says: "Do not add a polling daemon, database
  migration or credential provisioning to this slice." 016 is a separate proposed
  scope expansion, not an implicit exception to that decision.
- A neighboring draft 014 was mentioned in 015 but its contract is not present in
  the current checkout or inspected stash package. No authority is inferred from it.
- Existing VK control denial remains binding. A standalone process is technically
  separate from Codex CUA, but launching the same browser route is not permission.

## Outcome and operator interface — LOCK-VK-016

The owner issues one governed command in Planner and observes whether a running
standalone consumer accepted that exact job, its current stage, and its outcome.
Creating a work item must never be represented as acceptance by a live consumer.

Use the existing Publisher MCP surface as the primary command/status interface.
The secondary interface is a private local connector process with a status check
and a service-manager installation guide. No new web application is proposed.
Infrastructure verification uses a deterministic, non-provider execution adapter.
Production discovery must clearly show `provider_execution_blocked` until a
permitted provider route and real dependency smoke exist.

Pilot scope: explicit job for project10/task1048/channel117/community-240051152,
accepted revision1/asset130/feed, exact existing owner release. Do not harvest all
ready browser work items. Do not touch1084,1019 or the manual Kafka Clip. An
allow-list is an additional restriction, never authority to publish.

Proposed MCP commands (NOT implemented):

| Command | Observable result |
| --- | --- |
| `ba_dispatch_vk_connector_job` | Durable job ID, package hash and current state; accepted only after consumer receipt |
| `ba_get_vk_connector_job` | Job ID, stage, consumer receipt time, attempt/fact IDs or specific blocker |
| `ba_get_vk_connector_health` | Heartbeat age, infrastructure readiness and separate provider permission/auth status |
| `ba_poll_vk_connector_jobs` | Restricted consumer poll; immutable bindings and eligible job IDs only |
| `ba_ack_vk_connector_job` | Lease-generation-bound consumer receipt after local validation |
| `ba_reconcile_vk_connector_job` | Read-only provider inspection when permitted; exact unique match, proven scoped absence or UNKNOWN |

Names may be adjusted to repository naming conventions without changing authority.
Actor/project identity is derived from authenticated MCP credentials. Arguments
cannot elevate a Planner role to Publisher or widen the consumer allow-list.

## State, ownership and failure semantics

Planner remains authoritative for accepted content, approval, owner release,
work-item lease, delivery attempt, publication fact and metric checkpoints.
A new `ConnectorDispatchJob` is canonical only for transport execution status.
It references those existing entities; it does not contain a second approval or
publication truth. Proposed additive columns: project/task/channel/revision,
work-item ID, job ID, immutable package hash, owner-release fingerprint, state,
host ID, lease generation, receipt/updated timestamps, attempt/fact references,
and an allow-listed blocker code. Unique package binding and idempotency key
prevent concurrent or repeated dispatches from creating parallel jobs.
No credentials, lease tokens, cookies, browser storage or provider payload secrets
enter the new table, workflow events, health responses or logs.
An additive `ConnectorHostStatus` table stores authenticated project/host identity,
last heartbeat, build version, infrastructure mode and typed blockers. It stores
no credential; a registered host ID alone cannot authorize a command. Health
continues to work when there are no jobs, without modifying publication tasks.

`queued → accepted → reconciling → ready → executing → confirmed` is the normal
transport lifecycle. `blocked`, `verification_required` and `cancelled` are
explicit outcomes; none imply absence or successful delivery. `queued` requires
a durable command, `accepted` requires a real consumer acknowledgement,
`confirmed` requires the existing canonical fact transaction to have committed.
Infrastructure-only jobs may acknowledge and validate but end blocked before
provider navigation/upload; they must never report `ready` for live execution.

The immutable package fingerprint binds project, task, channel, numeric account,
accepted/content revisions, placement, body hash, selected asset ID/hash and exact
owner release. Recheck current task, release and lease before provider mutation.
A changed/retired/released-again/published package blocks the old job.

The consumer performs outbound authenticated polling of Publisher MCP. It has
no public inbound listener, no production database credential and one private
local profile. Serialize all jobs for that profile; a local OS lock supplements
server-side CAS. A competing process cannot acquire the same profile.

Use existing `claimVkBrowserPublication` → `claimWorkItem` for expired-lease
reclaim. Add binding/attempt checks around that existing operation; never direct
reset/update of WI1699. Reclaim alone must not authorize another provider send.
Job acknowledgements and stage updates are fenced to the active lease generation;
an older process cannot continue after reclaim. Shutdown stops taking jobs,
records the current safe stage and closes connections without automatic resend.

Before claiming execution, inspect canonical fact and all relevant attempts.
Existing confirmed fact returns the same fact; started/uncertain attempt permits
reconciliation only. Absence of a recorded attempt is not proof of public absence.
The provider read-only adapter is a separately permission-gated port: exact
community/caption/media binding, independently observed absolute provider time,
and bounded, explicitly scoped inventory coverage are mandatory. One old ranked
post, exhausted time budget or missing date returns UNKNOWN, not absence.
Historical publication with no attempt must use existing guarded fact recording,
with exact independent evidence; do not create a synthetic send attempt.

Durably start the existing delivery attempt before the first upload or submit.
After process/network loss at or beyond this boundary, freeze the job and use
read-only reconciliation; do not re-enqueue it even if its lease expires. A
pre-provider restart may resume only after durable stage/attempt checks and
permitted provider reconciliation. No new generic recovery may weaken existing
audited pre-provider/pre-submit recovery guards.

Only existing canonical publication-fact creation schedules measurement
checkpoints. Repeated confirmation/reconciliation must not duplicate facts or
checkpoints. A receipt, local file hash or screenshot alone cannot confirm media
identity or publication.

## Measurable requirements — QAR-VK-016

| Property | Proposed acceptance boundary |
| --- | --- |
| Receipt | With healthy deterministic consumer, command reaches durable receipt within 30 seconds |
| Health | Heartbeat every 10 seconds; older than 30 seconds is OFFLINE; this never proves provider login |
| Polling | Poll every 5 seconds, one active job/profile, capped backoff at 60 seconds after failure |
| Claim | Lease at most existing 3600-second limit; stale generations cannot mutate job/attempt/fact |
| Delivery integrity | At most one provider submission per immutable package; uncertainty permits zero retries |
| Privacy | Zero raw credentials/lease tokens/provider secrets in persisted or returned diagnostics |
| Scope | Wrong project/role/task/channel/revision/asset/release produces no accepted job or provider operation |
| Health isolation | Infrastructure-only health/dispatch tests make zero VK requests and open zero profiles |
| Provider inventory | Deadline120 seconds/100 objects maximum; incomplete coverage returns UNKNOWN |
| Verification | Focused boundary checks, DB concurrency checks, backend/frontend builds, quality gate and per-build TRUN required |

These are proposed limits, not observed performance of a live VK deployment.

## Architecture and migration — ARCH-VK-016

Components: small Planner dispatch repository/service and MCP tools; standalone
outbound consumer; platform execution adapter port; gated read-only reconciliation
port; health/receipt projection. Preserve current VK UI/submission-control modules.
The legacy Connector Host wrapper may be reused after individual compatibility
review; its older VK/X provider files must not overwrite current implementations.

Add additive dispatch/host-status tables and indexes rather than overload tracker outbox
events or work-item result payload with a second lifecycle. Existing
`task_tracker.service.ts` consumes outbox events; reusing them would risk accidental
dispatch or tracker interpretation. Old app/MCP builds ignore the new table.
Apply migration before enabling the new MCP command; the command defaults disabled
until schema and infrastructure smoke pass. Do not provision new credentials in
this code release; use an existing project-scoped Publisher credential if authorized.

Deployment: existing app/MCP on Railway; standalone consumer on the owner's host
through the OS service manager, default infrastructure-only. No browser profile
or authentication state is placed in Railway containers. On macOS propose one
LaunchAgent, owner-only configuration, and a private non-secret health file.
Host installation is a separate operator step, not something Railway deploy starts.
Other execution hosts require a reviewed equivalent; do not assume a remote
Windows browser session has the same profile or authorization.

Rollback: disable dispatch, stop consumer, revert app/MCP; retain jobs, attempts,
facts, workflow history and checkpoints. Leave additive tables in place. No DROP,
queued-job deletion, token revocation or uncertain-attempt reset is part of rollback.

## Security and adversarial review — RISK-VK-016

| Failure/threat | Required control |
| --- | --- |
| Wrong tenant/credential role | Credential-bound project/Publisher scope and explicit task allow-list |
| Concurrent consumer/replay | Unique job binding, serializable start, existing lease CAS, fencing, private profile lock |
| Restart after upload/send | Durable attempt precedes side effect; reconciliation-only when uncertain |
| Stale owner release/content | Full immutable fingerprint revalidated at receipt and before first side effect |
| Forged health/receipt | Scoped authenticated acknowledgement; health freshness separate from permission/login |
| Untrusted provider text/asset URL | Treat as data; existing SSRF/asset byte limits; no shell interpolation or instructions |
| Credential/profile exposure | Existing private local storage; no raw secrets in DB/job/status; no session extraction |
| Migration/rollback | Additive schema, disabled-by-default commands, preserve canonical history |
| Denied provider action disguised as daemon | Hard permission gate before any navigation; infrastructure adapter cannot import/run live UI |
| Provider absence overclaim | Coverage-bounded result; UNKNOWN blocks send; independent evidence required |

Reliance/harm: high data-integrity boundary with public and potentially irreversible
duplicate publication. Owner can stop the process, but cannot undo audience
exposure. Security, compatibility and rollback checks are required regardless of
unit test results. Provider media/time/coverage and owner usefulness remain UAT.

## Authorization and verification plan — AUT-VK-016

Approve this bundle before final scenarios and RED. Approval authorizes tests,
implementation and reviewed deployment of disabled-by-default dispatch and
non-provider infrastructure. It does not authorize new credentials, profile
access/login, live browser enablement, denied VK operations or other tasks.

After approval, finalize user scenarios and write failing acceptance tests at the
Planner-command → real local consumer boundary using deterministic provider ports.
Required coverage categories: receipt/offline/auth unavailable, invalid/stale
package, wrong tenant/role, concurrent dispatch, restart before/after attempt,
expired lease/stale generation, uncertainty, UNKNOWN inventory, exact confirmed
fact and exactly-once metric checkpoints. Synthetic tests do not establish live
VK ability. Perform focused review and quality/build checks before merge/deploy.

Infrastructure UAT: owner issues the pilot command and sees a genuine receipt from
the running consumer, followed by an honest provider-blocked status. Live UAT is
a separate gate after permitted provider smoke and complete reconciliation.

## Decision requested

Approve LOCK/QAR/ARCH/RISK/AUT-VK-016 as the input bundle: outbound polling consumer
on the owner's host, additive dispatch/host-status tables, existing governed lease/attempt/fact
controls, disabled-by-default provider execution, no API fallback.
No production profile/login bootstrap is requested at this gate.

## Delivery boundary and final scenarios after approval

The deployed tranche implements infrastructure-only transport. Its executable
has no provider port, browser import, profile parameter or live-mode option.
Receipt generation fences transport acknowledgements; it is not a canonical
WorkItem lease or a provider-readiness claim. WI1699 remains unchanged.
Expired transport receipts with no canonical attempt can be reclaimed; an existing
attempt blocks restart into dispatch. Existing `claimVkBrowserPublication`,
submission control and fact/checkpoint creation are preserved for a future
permitted provider integration, not invoked by this infrastructure-only process.
Provider inventory remains UNKNOWN and its scan/submit bootstrap is blocked.

Canonical existing facts are projected, never newly fabricated. No test claims
that projection creates a new publication or measurement checkpoint.

| Scenario | User boundary and expected persisted result |
| --- | --- |
| VK016-01/PROCESS | Explicit Planner command is queued; independent child process receives immutable package, records ACK then provider-blocked result; no attempt/fact |
| VK016-02 | Concurrent/repeated dispatch returns one durable job, no fake consumer receipt |
| VK016-03 | Health starts offline, heartbeat means infrastructure online only, stale health is offline |
| VK016-04/MCP | Disabled, wrong role/tenant/task or stale package creates no job; credential principal replaces caller actor |
| VK016-05/PACKAGE | Changed accepted revision/asset/body/release or held handoff cannot be accepted/executed |
| VK016-06 | Healthy competing instance cannot steal host/job |
| VK016-07 | Stale pre-provider transport receipt is recovered with new generation; old reports rejected; canonical WI lease untouched |
| VK016-08 | Started/uncertain canonical attempt blocks dispatch and transport restart |
| VK016-09 | Unavailable provider gives UNKNOWN/control-denied, never absence or retry permission |
| VK016-10 | Existing canonical fact projects same ID/URL on replay; no extra attempt/fact/checkpoint |
| VK016-11 | Repository package invalidation durably blocks job and keeps heartbeat/status readable |
| VK016-12/CONSUMER014 | Lost report after acknowledged receipt resumes only idempotent metadata report, no repeated ACK/provider send |
| CONSUMER001–015 | Private config/token/lock, exact package, timeout/cancellation, response validation, double process, lost report and FD cleanup |
| DISPATCH-016-DB | Exact additive SQL on temporary PostgreSQL enforces scoped references, uniqueness, history protection and infrastructure-only mode |

All runtime/tool names in the implementation are infrastructure capabilities.
Code release and deterministic tests are not live provider GREEN or owner UAT.
