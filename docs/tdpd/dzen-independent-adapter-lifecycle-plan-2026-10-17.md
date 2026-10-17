# Reusable Planner-owned Dzen lifecycle

Package `DZEN-ADAPTER-LIFECYCLE-001`; **PROPOSED / OWNER APPROVAL PENDING**.
Baseline `8748b950d0f4b7c36a7520c69197d8ebae93abf3`. One complete LOCK/QAR/ARCH/RISK
proposal covers independent publication and recovery. Offline milestones are
implementation steps, without separate routine approvals. Final scenarios, RED
and implementation follow combined approval under the project TDPD contract.
This preparation performs no production change, deploy or provider action.

## Closed stage and goal

PR174 merged5939dff; approved transition record PR176 merged0e33252; PR172 exact
head58b8324119108ae94f933d04a78d69e61c6ad0fe merged8748b95. PR172 removes
sandbox-disabling launch arguments at two existing sites, adds actual launch
options/cleanup regressions, and replaces six reviewed baseline identities with
all counts/metadata retained. Independent exact-head review: no P1/P2. Five CI
jobs,56 focused tests and backend/frontend builds passed. No native/session/UAT
readiness is inferred. No tests were rerun for this document.

Goal: an authorized owner uses the existing Planner publication command for any
eligible Dzen article package as validated data. A registered independent adapter
owns browser/session interaction. One lifecycle enforces release, complete
inventory, claim/start, one Submit, immutable receipt custody, canonical fact and
same-attempt recovery. Another ordinary account/task needs data, not production
functions/tools/allowlist branches or deploy. Existing1002 is a compatibility
case, not the new authority definition. No new preflight MCP command.

## LOCK — existing boundary and complete operator contract

| Existing source | Actual boundary gap | Proposed change |
| --- | --- | --- |
| `src/mcp/tools/task_publication_tools.ts` | `ba_publish_publication_task` calls executePublicationTaskByChannel: legacy Dzen ID list → Threads detection → Telegram.1002 is absent; it does not call PublicationDispatcher. | Keep command; resolve tenant-owned task/channel dynamically and invoke shared governed lifecycle, preserving non-Dzen behavior. Never add1002 to the ID set. |
| `src/mcp/remote-auth.ts` | Actor overwrite happens only if the argument exists; current generic publish schema has no actorId. | Pass trusted authenticated principal through internal server context, including configured local-server identity; inject unconditionally for governed operations. Missing context rejects; caller actor/first project owner never grants authority. Test actual remote scoping. |
| `src/services/publishers/publication_dispatcher.ts` | Independent legacy claim/status/fact and catch-to-browser fallback. Governed route blocks Dzen before fallback work. | Both entry paths delegate before legacy claims/status/fallback to one extracted service. Handled/blocked/reconciliation is terminal. Adapter missing/not-ready returns requirement; never fall through. Avoid materially extending this oversized module. |
| Shared browser contract/native/confirmation | Manual profile checks, platform/placement/fact assumptions; native gate onlyX; no separate Dzen receipt custody. | Reuse suitable owner/snapshot/CAS primitives. Implement generic provider-owned admission and immutable receipt lifecycle; no Dzen enum-only extension or caller-observation confirmation. Preserve other providers. |
| `dzen1002_runtime*.ts`, exact native/inventory | Fixed task/account/package literals and historical event namespaces. | Extract safety behavior into data-driven modules; retain validated compatibility readers/wrappers. Do not import exact constants as new authority. |

Extend the EXISTING `ba_publish_publication_task` with optional generic fields
`operation: release|publish|reconcile` (default publish), `expectedAcceptedRevision`,
`expectedPackageSha256`, `expectedManifestChecksum`, `approvalReference`, and
`attemptId`. Existing projectId/taskId/dryRun/idempotencyKey stay. Other providers'
existing contracts remain compatible. Reject inconsistent field combinations.
Actor is trusted server context; operation-level capabilities restrict release to
owner credentials and owner membership even if a publisher profile can call the
base tool. No caller transport, browser, endpoint, cookie,
receipt-authority, permission or allowed flag.

- Governed dryRun defaults true: stored package/registration/lifecycle diagnostics
  only, zero provider calls/releases/claims/WI writes. Return blockers/hashes and
  assurance; never infer fresh session or complete absence from stored proof.
- release + explicit apply: owner-only exact accepted text/asset/decision/account/
  schedule/manifest and approval-reference validation; one immutable release event
  and canonical provider WI/job. No attempt/browser/send. Publish does not infer
  release; ba_prepare_publication_task retains its existing meaning.
- publish + explicit apply: require idempotency key and exact expected bindings;
  consume matching release and independent complete inventory, claim/start and
  Submit once. Confirm only after retained receipt and atomic fact completion;
  otherwise blocked/verification_required, retry_allowed=false.
- reconcile: require original attemptId/key; dryRun is stored diagnostics, explicit
  apply completes retained receipt or requests same-object readback through the
  permitted registered adapter. No claim/release/Submit capability. Missing
  permission/evidence freezes that same attempt, never changes delivery key.

The effect switch is the EXISTING `dryRun` field: omitted or true always previews;
false explicitly applies the selected operation. There is no `apply` field.
For release apply require exact package/revision/manifest, approvalReference and
idempotencyKey, reject attemptId. Publish apply requires exact bindings/key and a
matching stored release; reject attemptId and inline approval creation. Reconcile
requires original attemptId/key for preview or apply, forbids approvalReference,
and uses immutable stored claim rather than requiring mutable current package
bindings; reject supplied conflicting expected fields. Non-Dzen callers may not
select new governed operations unless supported by their own provider contract.
The package fingerprint covers immutable material/account/revision/manifest and
approval binding, excluding generated attempt/lease IDs; release/claim identities
are bound separately, avoiding a self-referential digest.

Bounded outputs expose state/blocker/attempt identities, not content, cookies,
raw provider payloads or lease tokens. Existing exact commands remain compatible
wrappers with the same fences until retirement. This is one operator contract,
not another series of task-specific commands or inventory-only approval.

## ARCH — canonical ownership, independent adapter and state machine

Canonical truth remains ContentItem, release WorkflowEvent, WorkItem,
DeliveryAttempt and PublicationFact. Reuse ConnectorDispatchJob for transport:
its existing unique package and project/idempotency constraints are candidate
fences, not race proof alone. Resolve its WI/channel/asset/revision FKs from checked
records. Existing VK-specific repository/consumer constants are not reused as
permission or widened by Dzen work.

### Shared-table provider isolation before any new job is inserted

`vk_connector_repository.ts` currently queries active project jobs then applies
its strict legacy VK decoder. Inserting Dzen jobs without isolating that read
would poison VK polling. The prerequisite is a provider/protocol discriminator
in NEW generic job binding (for example protocol `owned_provider_v1`, provider
`dzen`, nested immutable package), checked in SELECT/claim/update predicates
BEFORE provider decoding. Preserve existing unversioned VK rows and strict VK
schema: legacy matching uses the linked channel/provider plus absence of the new
protocol marker, followed by the unchanged decoder. Never treat missing protocol
as generic Dzen or broaden the VK binding to parse Dzen.

Audit every existing queue consumer/repository and lookup: candidates, job,
jobByKey, jobByPackage, claim/CAS/update and status projections. Filter provider/
protocol before decoding; never claim, interpret or modify another provider's
job. Cross-provider project/idempotency collisions return explicit conflict,
never a foreign decoded result or silently create another job. Mixed-queue tests
must show Dzen cannot poison/starve VK polling and vice versa, while existing
unversioned VK behavior/history is unchanged. No Dzen job admission before those
selectors and their regressions pass. No schema change/backfill is implied.
Generic status/manual-action projections must respect owned lifecycle markers;
unsupported VK-only status readers cannot imply manual confirmation is allowed.

A shared service acquires the SAME tenant-scoped ContentItem row lock/CAS on
release/claim/start/submit/completion; inspect ALL prior legacy attempts/WIs/jobs/
facts before a new claim. Unique job identity alone cannot authorize another
attempt after key/revision/account change on the same item. All old/new producers
must use the ownership fence before mutation. Bounded DB-only serialization
retries are allowed before provider start; after start no retry dispatches again.

State chain: released → inventory_verified → claimed → started → submit_consumed
→ receipt_retained → fact_confirmed. Lost/uncertain outcome after claim becomes
reconciliation_only. Cancellation/expiry is not absence proof or resend authority.
Persist started before FIRST provider mutation; consume Submit once after current
role/release/package/manifest/account/asset/lease/generation checks. Session,
inventory, native mutation, submit and readback each keep their permitted action
boundary; recheck before external phases. Never convert adapter heartbeat into
login, action authorization or publication success.

Planner builds the immutable package from tenant-owned records and resolves a
server-registered provider/capability. The independent adapter process owns its
browser/session; caller cannot choose process/endpoint. Reuse existing Planner
server and encrypted account storage. Private bounded process IPC provides only
necessary secret handles; child environment excludes unrelated/DB credentials.
No raw cookies, payload secrets or IPC secret material are persisted/logged.
Test composition roots and fixture permission/transport ports cannot be imported
or selected by the production graph or request flags.
No new live bot/scheduler/duplicate consumer is activated by this implementation.

Dzen selectors/endpoints/network phase allowlists are provider protocol; account,
object, task/release/revision/asset bindings are validated data. Asset digest,
redirect, request/time/size limits and sandbox cleanup remain enforced. No Codex
browser/CDP/session injection, alternate API/worker/chat/manual fallback.

### Durable receipt and atomic truth

Validate and commit bounded immutable provider receipt against ORIGINAL committed
claim before fact completion. Bind provenance, account/object/permalink, exact
body/title/cover, timestamps and package digest. Internal server custody depends
on original attempt/claim, NOT current owner/manifest/package eligibility; later
drift must not discard already obtained post-submit evidence. This custody path
accepts no caller-provided receipt authority and makes no new provider call.

Fact completion separately authenticates the current actor and atomically records
fact + delivered attempt + job completion + audit, or keeps receipt and returns
reconciliation_required. All manual/MCP/REST/import confirmation paths respect
generic lifecycle ownership, including publicationFactService; caller-supplied
confirmationMode=automatic cannot supply internal authority. Conflicting receipts/
facts remain conflicts, never overwrite. Replay returns original verified result
with current access checks; same key/different request rejects. DB-only receipt
completion remains possible while native actions are restricted.

### Legacy adoption, concurrency and rollback

| Existing history | Required behavior |
| --- | --- |
| No attempt, exact valid owner release | Read and validate persisted release as data against current tenant/package/manifest. Recognize existing identity; no invented/renewed approval. No send before shared/live gates pass. |
| Claimed/pending/started/UNKNOWN, with or without job | Keep original attempt/key/release/lease/generation/event namespace. No fresh job, release, attempt, reset or resend; ambiguous history freezes. |
| Retained receipt, missing fact | Compatibility reader validates original immutable custody/digest; same-attempt completion only, surviving post-submit mutable drift. Never reconstruct receipt from current draft. |
| Confirmed or conflicting/multiple histories | Replay verified result; conflicts/multiplicity freeze. No second provider call. |

Recognize historical protocol/event versions as validated formats, not task-ID
execution branches. Exact wrappers/legacy claim writers must acquire/check the
same ownership fence so they cannot race the new generic route. Complete fresh
inventory never permits retry of a started/uncertain attempt. Legacy attempts
without a job complete only their original attempt/fact/audit: never create a
transport job for reconciliation. Job completion occurs only for an originally
linked and validated existing job; absence is not a missing-row repair trigger.

No automatic schema/data migration or backfill is proposed. Prove existing
constraints and shared row-lock fence with separate-process real PostgreSQL
races. If a schema/index change is required, revise this package with explicit
compatibility, backup and rollback; do not introduce one silently. Rollback
turns off NEW admission while retaining receipt/reconciliation readers and
ownership markers/history. It cannot return uncertain items to old send logic,
restore no-sandbox options or delete volumes/archives/attempt records.

## QAR — measurable limits and evidence

| Area | Proposed target and proof obligation |
| --- | --- |
| Identity/integrity | Two unrelated valid packages/accounts plus foreign tenant through same boundary/core; zero task-specific new production branches; zero provider/claim writes on denied/stale/revoked/foreign input. |
| Atomicity | Concurrent same/different keys, revisions and legacy/generic entry yield at most one started attempt/Submit per item; receipt survives faults at all later DB boundaries. Separate PostgreSQL processes/transactions. |
| Container/sandbox | Tower Linux amd64, UID1000, readonly source/root, cap-dropALL, no-new-privileges,2CPU/2GiB/256PIDs; no privileged/host network/socket/root mounts or published ports. Actual Chromium sandbox; startup failure blocks instead of disabling it. |
| Network/privacy | Offline container-local fixture only, zero external/Dzen requests/real credentials. Production phase allowlists and restrictions fail closed. Strict input≤64KiB, sanitized output/receipt≤64KiB, secret IPC≤1MiB and never logged. |
| Native budgets | Retain current asset≤2,000,000bytes, cookies≤65,536chars, body≤50,000chars, fetch≤15s, browser phase≤180s. Inventory≤60s/50pages/10000objects aggregate; BOTH collections require explicit validated completion. Limit/cursor loop/unknown paging = incomplete. |
| Lifetime | Whole invocation≤240s including startup/cleanup, close/kill adapter+browser≤10s after timeout/cancel. Cancellation after claim freezes; no new claim. |
| Operations/cost | Temporary job per test --rm; logs10MiB×2, tmp logs≤16MiB. No scheduler/worker activation. Heartbeat or receipt alone never canonical success. Resource exhaustion leaves held state/evidence. |
| Compatibility/quality | Non-Dzen generic behavior, shared browser providers, exact wrappers and manual-fact guards covered. Required quality/build/regressions pass; no baseline widening/new any/silent catch/god module. |

These are proposed engineering ceilings, not measured provider capacity. Material
changes to budgets/boundaries invalidate affected requirements; routine choices
within the approved package do not need another technical approval.

## RISK — threats and clearing evidence

| Risk | Mitigation and verification obligation |
| --- | --- |
| Forged/missing principal or first-owner fallback | Trusted context across actual remote/server entry, owner/tenant validation; no context rejects before protected data/provider access. |
| Shared queue poisons another provider | Provider/protocol predicates before decode on every read/claim/CAS/status path; preserve unversioned VK; mixed-queue and cross-key conflict regressions. |
| Alternate dispatch or manual fact bypass | Both entry paths and every producer/fact writer use ownership fence before writes; unavailable/denied adapter is terminal. Existing Dzen/VK denial remains. |
| Crash, new key/revision or old/new race duplicates send | Row lock/CAS + unique constraints + all-history inspection; real DB races; UNKNOWN never resends. |
| Post-submit drift loses receipt | Separate receipt commit bound to immutable claim, independent of current eligibility; fault injection through completion/role/manifest failures. |
| Worker/IPC impersonation | Trusted registration/fixed executable/minimal env and per-invocation attempt/lease/generation binding; caller cannot select transport or receipt authority. |
| SSRF/malicious page/log leak/browser escape | Phase allowlists, digest/size/time limits, actual sandbox, no arbitrary redirects, bounded sanitized errors. |
| Incomplete inventory/legacy ambiguity becomes permission | Explicit complete published+draft evidence or BLOCKED; legacy UNKNOWN remains held regardless of absence. |
| Rollback re-enables legacy sends | Disable new admission only; preserve original evidence, receipt readers and ownership fences. |

The companion independent architecture/risk review must identify the reviewed
revision and open findings. This table itself is author analysis, not an
independent verdict. Resolve material findings before asking for owner approval.

## Incremental offline execution under ONE approved lifecycle package

After combined LOCK/QAR/ARCH/RISK approval, author final operator scenarios and
RED tests, then implement these milestones without separate routine approvals:

1. Trusted principal, dynamic provider routing and immutable package/release.
2. Shared queue isolation, ownership, legacy adoption/receipt readers and serializable race proof.
3. Registered independent adapter + actual sandboxed local inventory.
4. Local fixture edit/upload/one Submit + receipt-before-fact fault injection.
5. Same-attempt recovery, manual/import/batch bypass and rollback validation.
6. Required quality/build/regressions, independent final review and TRUN/UAT handoff.

Coverage obligations include two valid packages/accounts, foreign tenant,
stale/revoked bindings, duplicate keys, phase failures and legacy uncertain/receipt
states. These are not final scenarios or a claim that current56 tests cover the
missing lifecycle. No milestone exposes Dzen as live-ready or cuts over production.
Capabilities remain disabled/held until the real release conditions pass.
Material architecture/risk/migration changes require review; minor refactoring
inside approved boundaries does not.

## External restriction and actual deployment/live/UAT gates

Actual Browser Use refusal: call `call_34840360c84440a286f2230a22165d96`,
2026-10-11T21:17:42.380Z, opening1045 article
https://dzen.ru/a/asvdioZFzXeQEO5O; same-outcome indirect workarounds forbidden.
Durable evidence: /Users/innokentyb/Documents/Product/PM/evidence/DZEN1045_TO_1002_SCOPE_FINDING_2026-10-16.json.
The production action guard retains that provenance and blocks native work.
Applicability to1002 inventory/publish/readback is UNKNOWN: neither a blanket
Dzen ban nor proven nonapplicability. No authoritative scope/clearance API was
established. No owner flag, invented service, tool/adapter change or experimental
probe resolves this. Authoritative clarification must address the original
incident and exact intended actions; it is independent of engineering approval.

Offline engineering may proceed after this package approval while native work
stays held. Deployment/activation later needs its concrete reviewed container
build/config, immutable build identity, bounded health/log/stop/rollback commands,
minimal secrets and explicit owner authorization. No copied live database,
duplicate consumer or automatic queue replay.

Before permitted real smoke/send: authoritative action-scope evidence; real
adapter registration/health/session; complete current inventory; exact current
owner release/package/manifest; no uncertain original attempt. Existing1002 GO
remains recorded and is not requested again because code moved. Changed binding/
stale approval is a concrete conflict, never permission to silently rebind.
Permitted real-path smoke and explicit human UAT remain release requirements;
synthetic GREEN is insufficient.

One next owner verdict: approve or revise THIS complete lifecycle engineering
LOCK/QAR/ARCH/RISK package. Approval authorizes scenarios/RED/implementation through
all offline milestones, not merge/deploy/live publication or policy clearance.
Prior PR174/stage2/PR172 merge approvals are complete and need no repeat. No new
owner approval is requested merely for local inventory or the next test milestone.
