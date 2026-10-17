# X-NATIVE-STATE-READ-001 v1.1 — LOCK/QAR/ARCH/RISK

Status: **DRAFT FOR INDEPENDENT REVIEW; NO IMPLEMENTATION AUTHORITY**.
Producer: Planner engineering, Design & Requirements. Decision: human owner via
Portfolio OS. Consumer: sole scoped Publisher. Source examined: `edfc68a812f5b0ee917e4603a8629148b4547689`;
unchanged reviewed server merge: `d233b2b51abade97a5f273b24788108838167ae9`.
Supersedes the earlier open-ended Tower observability proposal. Reviewer/version,
findings and human verdict must be recorded separately, never inferred.

## LOCK: one scoped observation, not a publication gate

Problem: Ops cannot distinguish absent from live/revoked/inconsistent prior
enrollment using its current authenticated catalog. Missing visibility is UNKNOWN,
not zero. Add exactly ONE MCP read command: `ba_get_x_native_state`.
No HTTP route, extension operation, settings dump, global jobs platform, provider
access, migration or mutation. One project + canonical X channel + exact task.
Business identifiers are validated data; no account/task-specific production code.
Tower UI/login and existing copy/publication approval need no repeat GO.

### Strict request

All five fields required; no additional properties:

| Field | Constraint |
| --- | --- |
| projectId, channelId, taskId | integers 1..2147483647 |
| candidateInstallationId | lowercase hex, exactly64 characters |
| actorId | existing transport-injected `user:<Id>` form, same positive32-bit integer bound |

Actor is NOT caller authority. Reuse existing `scopeRemoteMcpRequest`: authenticated
principal overwrites actorId; cross-project mismatch rejects. Preserve session/
credential/profile binding. Owner/Publisher discovery only, behind existing
`X_NATIVE_PILOT_ENABLED=true`; Planner/other profiles cannot discover/call it.
Domain `requireBrowserOwner` still requires actual project-owner membership:
Publisher profile alone is insufficient. No identity override or bearer extraction.
Reuse the current trusted-local/remote transport model; no new unauthenticated
remote route or local-stdio-to-remote bypass is introduced.

After owner check, require channel.project_id/type=x and exact task.project_id/
channel_id. Missing/foreign channel/task gives uniform `X_NATIVE_STATE_SCOPE_DENIED`.
Inactive/misbound channels remain readable with typed binding warning, not ready.
Binding.status is purely administrative and deterministic: project only
channel.config.account_ref/account_type and the first non-empty profile among
profile_url, channel_url, raw_account.url, account_ref (same precedence as existing
browserSnapshotMismatches), plus task.quality_report.browser_identity_binding.identity
fields platform/accountType/accountRef/profileUrl/providerAccountId. Never select
or emit the rest of channel.config. A valid channel tuple is @handle matching
`^@[A-Za-z0-9_]{1,15}$`, exact HTTPS x.com/handle profile (one trailing slash may be
removed), and personal type (legacy absent/unknown account_type resolves personal,
as existing X snapshot rules do). No case folding. Missing channel tuple or task
identity =>unbound; present malformed/conflicting values or non-object metadata
=>inconsistent (takes precedence over missing). Both present/valid and task
platform=x/accountType=personal/accountRef/profileUrl/providerAccountId exactly
matching that tuple =>consistent. Channel active flag is separate. None establishes
provider ownership, current Registry verification or execution readiness.
No accepted snapshot/manifest requirement for forensic reading; mutations still
recheck their exact current canonical context. Do not invent a current approval.

This version accepts NO `limit`, `cursor`, `apply`, `nonce`, arbitrary key/filter or actor
selector. Unknown fields reject. It is one capped atomic snapshot, not paginated:
no cursor tokens, cross-page consistency fiction or persisted snapshot state.

### Strict response

Id=integer above; Hash=64lowercase hex; Time=24-character UTC ISO8601 with
milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`). Nullable fields are
explicit null, not omitted. Top-level keys only:

| Key | Shape |
| --- | --- |
| schemaVersion | literal1 |
| scope | {projectId:Id,channelId:Id,taskId:Id,candidateInstallationId:Hash} |
| observedAt | Time from this transaction |
| complete | boolean; installations.complete AND taskState.status=known |
| binding | {channelActive:boolean,status:consistent/inconsistent/unbound} |
| installations | inventory below |
| taskState | exact-task booleans below |
| warnings | unique enum array, max8 |
| effects | {mutatesState:false,providerCalled:false,submissionPermitted:false,registrationAuthorized:false} |

Inventory keys: `{complete:boolean,totalCount:integer0..20|null,candidateState:
absent/active/revoked/untrusted/unknown,otherActivePresent:boolean|null,rows:Row[]}`.
Rows sorted by installationId, max20. totalCount is exact ONLY if complete,
otherwise null. Candidate absent or otherActivePresent=false requires completeness.
Row keys: `{installationId:Hash,extensionId:32[a-p]|null,bundleSha256:Hash|null,
registeredByCaller:boolean|null,effectiveState:active/revoked/untrusted,
auditStatus:verified/missing/mismatch/unknown,registeredAt:Time|null,
revokedAt:Time|null,updatedAt:Time|null}`. No JWK/UATreference/rawactor/settings key
or value/workflow payload. Binding emits no raw config or claimed provider ownership.

TaskState keys: `{status:known/unknown,attemptPresent:boolean|null,
unresolvedAttemptPresent:boolean|null,browserWorkPresent:boolean|null,
nonterminalBrowserWorkPresent:boolean|null,nonterminalDispatchJobPresent:boolean|null,
publicationFactPresent:boolean|null,publishedLinkPresent:boolean|null,
currentReleasePresent:boolean|null}`. This is NOT all release/job history.
Unknown/failed decoding never becomes false. No raw status/error/lease/key/proof,
accepted copy or provider payload. Existing diagnosis/reconciliation supplies
necessary details separately. Successful read never emits ready/allowed.

Warning enum only: INVENTORY_OVERFLOW, AUDIT_OVERFLOW, INVALID_RECORD,
AUDIT_INCONSISTENT, BINDING_INCONSISTENT, CANDIDATE_REVOKED,
OTHER_ACTIVE_INSTALLATION, TASK_DELIVERY_HISTORY. Warnings are diagnostic, not
a new executable gate. Error DTO only `{code,mutatesState:false,providerCalled:false}`.
Code enum: OWNER_REQUIRED, X_NATIVE_PILOT_DISABLED, X_NATIVE_STATE_INVALID_INPUT,
X_NATIVE_STATE_SCOPE_DENIED, X_NATIVE_STATE_BUSY, X_NATIVE_STATE_TIMEOUT,
X_NATIVE_STATE_RESPONSE_LIMIT. These are service DTOs; existing auth/JSON-RPC
transport errors keep their established envelopes and are not successful DTOs.
No raw exception/partial zeros after timeout.

## ARCH: existing transaction, narrow projections

One existing Prisma RepeatableRead transaction; its first transaction statement is
`SET TRANSACTION READ ONLY`, before owner/scope queries. Fixed parameterized
SELECT/projection SQL through that transaction only; no dynamic identifiers.
No domain writes, workflow append, nonce consume, lease renewal, cache table,
key generation, browser/provider/network-dispatch callback or new credentials.

Inventory is the UNION of settings with exact authenticated
`x_native:installation:v1:<channelId>:` prefix and register/revoke audit keys with
exact `<channelId>:` prefix. Do not filter audits by caller actor: a different
owner's old live key must be visible. At most21 distinct validated IDs (sentinel
included); over20 is incomplete, never empty. BEFORE discarding malformed suffixes,
run a bounded-output invalid-key EXISTS over both exact prefixes. Any malformed
identifier sets complete=false + INVALID_RECORD; omit the unrepresentable raw key,
totalCount=null, prohibit candidate=absent/otherActivePresent=false. Never silently
filter an invalid key into an apparently empty valid-ID inventory.
For those IDs inspect max80 relevant
register/revoke audit rows plus one sentinel; overflow means incomplete. Values
max2048UTF8bytes each. Oversized/malformed rows are untrusted/unknown, never skipped.
An audit-only key with missing setting is untrusted, not live authority.

Preserve `installedNative` semantics: validate scope/fingerprint and immutable
registration hash. ANY sticky revocation event OR revoked setting wins over a
mutable active flag. For revoked records validate against ORIGINAL registration
form, not the changed revoked-row hash. One batched per-ID revocation EXISTS
projection must be exhaustive for each emitted ID, independent of the80-row audit
display/validation cap. A true result or revoked setting always yields revoked.
An active row/candidate requires valid complete per-ID enrollment evidence AND
exhaustive revocation=false. Audit overflow or incomplete enrollment evidence
cannot leave a potentially affected candidate active: use candidate=unknown,
row=untrusted/auditStatus=unknown and otherActivePresent=null unless another
effective-active row is independently fully proved. Missing/inconsistent audit cannot prove
candidate absent/no other active. Never call register/revoke as a read probe.

TaskState uses bounded EXISTS projections across ALL revisions/historical
channels of this exact project/task, matching `noBrowserDelivery` scope:
any DeliveryAttempt; unresolved=pending OR requires_manual_confirmation;
any browser_publish WorkItem, nonterminal=state NOT IN(cancelled,completed);
ConnectorDispatchJob nonterminal=state NOT IN(cancelled,confirmed); fact/link
presence; persisted quality_report.browser_release presence. Malformed/non-object
release metadata is unknown, not absent. Project booleans in SQL without loading
raw errors/tokens/JSON payloads. Max24 SELECT statements including auth/audit
batches. All categories share this transaction snapshot; no pagination.

Proposed small x_native_diagnostics service/DTO, existing native MCP facade and
Owner/Publisher capability set. No changes to registration/revocation/executors,
Prisma schema, environment variables, global registry, browser or sender.

## QAR: measurable ceilings

- Args<=512UTF8bytes after existing MCP envelope parsing; response<=32768bytes,
  measured before emit. Existing transport envelope limit remains unchanged.
- Inventory20, audit80, per-value2048bytes; sentinel overflow=>unknown.
- Statement timeout1000ms; transaction timeout1500ms; acquisition maxWait300ms;
  service deadline2000ms. Cancel on timeout; no partial successful zeros.
- Max2 concurrent diagnostics transactions per process; third gets BUSY before
  DB acquisition. Fixed counter released in finally, no unbounded per-user map.
  This is NOT a distributed/global flood limiter.
- Container+real-PG verification:100 requests at1RPS/concurrency2 on limit-size
  seeded state; p95<=750ms/p99<=1500ms, no pool leak. Record actual hardware/result.
- Zero writes/provider/browser/dispatch calls in happy/error paths; synthetic DB
  before/after hashes+counts unchanged. No secrets in DTO/error/log snapshots.
  Existing quality/build and auth/tenant regressions must pass after implementation.
- Observation is not a lease/release token or cached safety verdict. Re-read
  before trust changes, but freshness alone is not permission or atomicity proof.

## Required invariant and relevance, not blanket absence

| Category | Actual relevance |
| --- | --- |
| Candidate enrollment/audit/revocation | Avoid rebind/adoption of revoked/untrusted key; current per-key registration checks apply. |
| Other effective-active key, SAME project/channel | Potential second trusted installation. Sole Ops resolves intended key/migration; no auto revoke. |
| Any attempt for exact task, even old revision/channel | Existing release/claim/start reject a second attempt. Started/UNKNOWN=>same-attempt reconciliation. |
| Browser WI/current release for exact task | Existing lifecycle/lease: preserve/diagnose, never create second executor. |
| Nonterminal dispatch job for exact task | Native X uses no such transport (dispatch requires asset), BUT shared noBrowserDelivery checks it; stray historical job can already block release. Surface that predicate only. |
| Unrelated jobs/tasks/channels/projects | Not queried; no required global absence or new jobs gate. |
| Expired/unused pairing/challenge history | Not independent execution authority: pairing enables enrollment only; execution rechecks key, phase nonce, exact release/lease/attempt and consume CAS. No project-wide nonce scan. |
| Complete historical release enumeration | Not required to make a second send safe: exact-task attempts/WIs/fact and immutable current release guards remain authoritative. Not promised by this read. |

Existing register uses Serializable, unique(project,key), immutable same-key replay
comparison and CAS consumption of a one-shot pairing inside enrollment+audit
transaction (`x_native_registry.ts:29-55`, `x_native_pairing.ts:106-125`). That
protects THAT key/proof. It does NOT enforce one active key/channel, does NOT call
noBrowserDelivery, and does NOT invalidate another key. Preview/this read are not
atomic with later apply. Sticky revocation is rechecked at challenge/delegate
consumption (`installedNative`), not a journal-reset mechanism.

Duplicate-send fences remain separate: revision-bound WI/release CAS, lease CAS,
attempt count+start status CAS, current phase pointer+nonce consume CAS, single-use
permit and local journal (`browser_publication_release/execution`, `x_native_state/
control/execution`). This read does not strengthen or replace them. A channel-wide
exactly-one-key CAS or server key-switch-while-inflight guard is a DIFFERENT
mutating architecture delta, not hidden in this packet.

## RISK / independent review obligations

- HIGH: tenant/actor spoof and secret disclosure. Principal/profile+owner checks
  BEFORE scoped state; uniform denial; whitelist DTO/projections, no secret fallback.
- HIGH: false absence via caps, stale mutable flags or missing audit. Union both
  sources, sentinel caps, sticky revocation and unknown/null semantics.
- MEDIUM: read-to-register race. Explicitly observational. Existing sole-Ops/no
  concurrent enrollment boundary is necessary; multiple owner clients can still
  enroll distinct keys. Approval of READ does not approve or prove exclusivity.
- MEDIUM: authenticated load. Ceilings/deadlines+2active reads/process; MCP-wide
  flooding remains baseline risk, not claimed solved here.
- Rollback removes only read tool/capability after reads drain. No data/key/journal/
  lease/audit/fact migration or revocation; sender unchanged.

Reviewer must challenge: spoof/foreign tenant/missing principal, Publisher without
owner, forbidden roles, foreign/non-X task; unknown limit/cursor/apply;
21IDs/81audits/2049byte value/32769byte response; revoked despite mutable active;
audit-only/malformed row or suffixkey; hidden row81 revocation must never report
active; missing versus malformed canonical binding, precedence and exact case;
another owner's active key; historical-channel attempt;
exact-task stray dispatch versus unrelated jobs; coherent snapshot during writes
WITHOUT exclusivity claim; timeout/counter/pool cleanup; zero writes/provider spies.
These are draft design-review obligations, NOT approved final scenarios or TRUN.

## Human gate

AFTER independent review, request exact LOCK/QAR/ARCH/RISK verdict for implementing
and testing this ONE scoped MCP read, then ordinary review/deploy+actual readback.
No registration/send authority, cookie import, XGO/Tower decision replay. Until
verdict, no implementation/final scenarios. Independent Tower owner login remains
available; missing global jobs visibility is NOT its blocker. Real UAT is separate.
