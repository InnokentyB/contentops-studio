# DZEN1002-RUNTIME-001 — complete existing-runtime application slice

2026-10-16, Europe/Lisbon. PROPOSED LOCK/QAR/ARCH/RISK; human verdict pending.
Baseline: deployed PR159/ffe3435f99bf54f05748ca23a94c41dfb28efbc8.
This replaces the preliminary accuracy-only draft. One application slice covers
inventory, durable attempt, receipt, fact and reconciliation. No new worker,
schema, secret, session/profile or clearance service.

## Existing authority and one new material decision

Direct human architecture direction covers a bounded Codex -> Planner command,
Planner-owned transport/session and actual result/error. The existing server
process is selected as instructed. Preparation, source inspection and independent
review are assigned. Historical release3126, rev3/decision300v2/asset151, hashes,
dates and manifests remain intact. No renewed general permission is requested.

One new LOCK/QAR/ARCH/RISK verdict is needed for the complete application delta:
replace the disconnected DIAG001 admission model, extract task1002 from legacy
send, and introduce canonical attempt/receipt/fact transitions in existing tables.
This materially changes operator behavior and persisted state. Architecture
instructions and DZEN1002-MANIFEST-001 did not approve those exact transitions.
Approval covers implementation/tests of the entire slice, not provider-policy
overrides, deployment, publication or UAT. No final scenarios/RED before approval.

## Verified boundary and actual defects

Authenticated remote MCP binds actor/project from principal, then calls the
exact task1002 command -> manifest/package/owner guards -> DzenService -> server
Puppeteer. Stored channel cookies are resolved/decrypted inside Planner through
existing channel utilities. No plaintext credentials were inspected. Live session
custody, browser availability and provider conformance remain unverified.

The native inventory already bounds pages/time/bytes, reads published and draft
collections, blocks non-GET/HEAD traffic and closes browser in finally. Unknown
pagination cannot prove absence. Three no-argument admission calls always throw
before provider access; no production admission service exists in this graph.

Legacy execute claims ContentItem and quality_report state, but creates no
DeliveryAttempt. The returned URL is persisted only through fact success or a
fact-failure catch. A crash can lose that receipt. Fact and final task/audit writes
are separate. Deleting the guard alone cannot safely enable publication.

## RISK: real restriction is separate

Browser Use refused opening published task1045 article
https://dzen.ru/a/asvdioZFzXeQEO5O at 2026-10-11T21:17:42.380Z and forbade indirect
achievement of the same outcome. That outcome stays prohibited through every
adapter/process/tool. Source: dzen-admission-origin-audit-2026-10-16.md in the
originating checkout. It proves neither blanket Dzen ban nor permission1002.
Applicability1002 remains unresolved; no live probe may test around the refusal.

The application reports this precise local unresolved scope before session/native
access, rather than fictional clearance outage or fresh provider response. No
config permitted flag, cached proof, owner approval or adapter marker resolves
policy. Full offline implementation is possible while live entry stays closed.
Supported action-scope evidence is required for native enablement; this packet
does not ask a human to override the actual tool restriction.

## LOCK: operator behavior

Keep current release/preflight/publish inputs. Add one owning Publisher bounded
reconciliation command: project10/task1002, authenticated actor/current expected
manifest, original attempt ID and idempotency key. No send capability, arbitrary
URL/script/selector/transport/session input. Receipt and browser handles stay
internal. Dry-run distinguishes stored proof from fresh native readiness.

When permitted, preflight returns actual sanitized complete inventory/error.
Publish can create one attempt before any provider mutation. All later calls,
including other keys, return matching canonical fact or reconciliation-required.
UNKNOWN/start/crash/expiry never authorizes resend. Reconciliation consumes a
verified retained receipt, or separately permitted exact same-attempt readback;
no receipt or ambiguous evidence stays frozen.

## ARCH: concrete file and transaction contract

New typed modules (each below400 lines):

- services/dzen1002_runtime_contract.ts: strict package/claim/receipt/result schemas.
- services/dzen1002_runtime_store.ts: typed Prisma TransactionClient inspection,
  claim/start/receipt and completion fences.
- services/dzen1002_runtime.ts: typed bounded orchestration and production ports.
- services/dzen1002_action_restriction.ts: actual denial provenance and explicit
  unresolved scope; no external I/O or caller/config permission seam.
- services/puppeteer/dzen1002_publisher.ts: dedicated same-process adapter, reusing
  existing editor/cookie helpers, exact native pre-submit/readback checks.

Only exact task1002 seams change in route, DzenService, MCP registration/capability
allowlist and legacy publication facade. The latter is902 lines: early delegation
only, no material extension. Remove old probe helper after checking all three
importers. Preserve native capture/pagination; inspect source-contract tests first.
Other providers/tasks and LinkedIn1086 files/rows are untouched. Document the
same-process adapter/custody without treating its identity as permission.

Also change publication_manual_fact_guard.ts for exact p10/task1002: generic MCP
and REST fact/confirmation writes must require the dedicated internal receipt
completion hook, before claim and after every lifecycle state. Otherwise an
authorized generic caller could bypass the new canonical lifecycle. No broad
provider-wide fact restriction is introduced; no existing fact is deleted.

Reuse threads1114_store serializable CAS/attempt pattern and fact beforeWrite
hook; inspect LinkedIn/VK fencing as reference only, without copying their provider
logic. No generic deliveryService fallback: its attempt is outside task claim.

### 1. Claim before side effect

One Serializable transaction re-reads owner/tenant, exact task/channel/account,
accepted/content revision, body/asset hashes, HTTPS asset, decision300v2, dates,
original release3126 package, current manifest and fresh complete inventory proof.
Reject any existing fact, DeliveryAttempt, old legacy claim or uncertain/start/
fact-pending state. Revalidate hashes rather than trusting request or stale read.
CAS ContentItem on updated_at plus exact eligible status/package. Create one
DeliveryAttempt(pending,automatic,key,channel116) and append unique system-actor
WorkflowEvent ba_publish_dzen_task1002:claim with attempt ID, full nonsecret package
snapshot/digest and original release ID, in the same commit. Losing CAS or
serialization conflict rolls back everything and performs zero provider calls.
No transaction retry contains provider code; only fresh committing invocation
receives internal claim result. Replays never receive dispatch authority.

### 2. Start fence

Immediately before first draft/edit/upload mutation, second Serializable
transaction revalidates package/release/manifest/attempt and appends unique
system-actor :started event keyed by attempt ID/package digest. Only the fresh
commit permits that invocation's transport entry; no reusable token is returned
through MCP. Other process/key cannot start. No timer/lease expiry reopens it.
Crash after claim/start freezes even if provider was never reached. This trades
availability for no automatic resend. Package drift after start can still happen;
pass immutable claimed payload and recheck before final submit, freeze on drift.

### 3. Native proof and durable receipt before fact

Adapter verifies account and native title/body/approved-cover/final dialog before
submit. After submit, require exact provider object/account, canonical HTTPS URL,
publication time and native content/cover observations sufficient for accepted
artifact verification. A URL extracted from arbitrary payload is insufficient.
Never substitute expected values for missing native observations; unsupported
shape/readback stays uncertain. Do not introduce navigation to prohibited1045.

Task1002 proof is independent of hardcoded1045 proof: fixed authenticated account
6a8029aba055ec36033bf81c and same native object ID across submit response, Studio
row and primary article/editor observation; title equality and full primary-body
equality after specified CRLF/NBSP normalization only. Never search whole-page
innerText or accept a recommendation/sidebar substring. Cover must be observed
as the same native object-bound asset and verified against approved151 hash using
bounded allowed native image bytes; inaccessible/transformed/unrecognized cover
is unverified, not equal by assumption. Require observed published state/time in
same-object native metadata and exact canonical HTTPS URL/object agreement.
Supported response/DOM schemas are allowlisted fixture versions; unsupported
shape freezes result. Generic article reader and1045 helper cannot supply missing
account/cover proof. No claim of native feasibility before permitted smoke.

Validate and append :receipt WorkflowEvent in its own Serializable transaction,
bound to original attempt/claim/start/account/package and receipt digest. Strict
allowlist: identity/time/hash/evidence only, never payload/cookie/header/token.
Same receipt is idempotent; changed receipt conflicts. Scoped attempt becomes
verification_required in same commit, not delivered. Receipt is not success.

Then PublicationFactService.record(artifactKind=article, automatic) with existing
beforeWrite hook: re-read receipt/claim/package and original attempt in the fact's
Serializable transaction; reject mismatched/conflicting fact; CAS attempt to
delivered and append completion audit. Existing fact service writes canonical
fact and ContentItem published transition atomically with this hook. Task1002 no
longer uses legacy second success transaction.

beforeWrite runs before the fact service's equal-fact replay branch: when the
attempt is already delivered, verify matching receipt AND canonical fact, then
return without another CAS/audit. Otherwise CAS pending/verification_required
once and append unique completion. A concurrent reconciliation loser or a
commit-success/response-loss caller re-reads canonical completion after conflict;
it never dispatches or overwrites a conflicting fact. Do not copy Threads' pending-
only CAS unchanged. Retry is allowed only for this DB-only finalization/read.

Fact transaction failure leaves committed receipt for same-attempt reconciliation
with zero send. Receipt-write failure leaves earlier started fence; no retry or
fabricated fact. Crash between external effect and receipt remains UNKNOWN and
requires permitted same-attempt readback. No external exactly-once guarantee or
elimination of native-effect/DB crash window is claimed.

### 4. Replay/reconciliation

Check current authenticated ownership and manifest, then durable history.
Matching canonical completion returns published identity. Same key/new package
conflicts; new key cannot create another attempt. Pending/uncertain without valid
receipt stays reconciliation-required independent of process age. Same receipt
completion is idempotent. Reconcile cannot claim/compose/edit/upload/submit.
No reset, backfill, release rewrite or resend authorization.

## QAR: test contract after the one human verdict

Write acceptance RED through registered MCP handlers with synthetic authenticated
principal, injected native transport and isolated test DB; unexpected network or
session access throws. Retain per-build TRUN and errors. Setup failure is not RED.

| ID | Decisive requirement |
| --- | --- |
| R01 | Exact owner request: one attempt/claim before first side effect, verified receipt then one canonical article fact/delivered attempt. |
| R02 | Foreign tenant/role/account or stale manifest/revision/decision/body/asset/date/release: zero attempts/writes/provider calls. |
| R03 | Unresolved scope/config permission/cached proof: zero session/native calls; actual1045 provenance preserved. |
| R04 | Parallel same/different-key calls: one attempt and at most one transport entry; loser rollback never retries native code. |
| R05 | Drift between inspect/claim/start/submit blocks affected action; stale invocation/crash/expiry never grants second send. |
| R06 | Faults before/after claim/start/native submit/receipt and during fact transaction retain correct evidence; all keys stay no-resend. |
| R07 | Receipt committed + fact DB failure: same-attempt reconciliation completes with zero send; conflicting receipt/fact cannot overwrite. |
| R08 | Wrong account/object/URL/time/body/title/cover or incomplete native inventory/readback: no fact/success; bounded sanitized error. |
| R09 | Completed replay returns canonical identity; receipt/heartbeat/HTTP200 alone never success. |
| R10 | Generic/legacy entry cannot bypass task1002; other Dzen/VK/LinkedIn regressions stay green. |
| R11 | Real isolated Postgres concurrent transactions + rollback prove R04/R06; missing DB blocks, never skipped GREEN or fake-only claim. |
| R12 | Mixed-version rollback preserves started freeze and receipts; old PR159 guard fails closed; no deletion/reset/resend. |

R07/R09/R11 additionally cover simultaneous reconciliations and fact-commit success
with lost response: both resolve to the same canonical identity with one completion
audit. R10 exercises generic MCP AND REST fact/confirmation entry points before
claim, after started and after receipt; all bypass writes reject. R08 fixtures
reject recommendation-body matches, extra/missing primary body, foreign account,
object mismatch and missing/unsupported/transformed cover evidence.

Run backend build, focused suite, relevant Dzen/MCP/delivery/fact/VK no-fallback
regressions and quality gate. Deterministic tests prove app contract only; native
provider conformance and human UAT are separate.

## Compatibility, rollback and remaining evidence

No schema migration: existing DeliveryAttempt key/status fields; WorkflowEvent
JSON and unique(project,actor,command,key); fact beforeWrite atomic hook. Do not
change shared provider invariants. Rollback disables new task1002 dispatch,
retains all evidence and allows only reviewed same-attempt reconciliation.
PR159 rollback remains fail-closed; never select pre-guard binary.

Native operation still needs supported applicability evidence, verified actual
adapter/session custody/readback and deploy authorization. Owning Publisher then
checks live exact release/package/history before a permitted action. Approval
of this application slice is not native permission or publication acceptance.

### Native action-scope resolution: concrete operational remainder

Source of the actual restriction is the Browser Use tool result, call
call_34840360c84440a286f2230a22165d96 in Portfolio OS, not Dzen or a Planner
authorization server. Its known operation/outcome is opening the public1045 URL.
The proposed1002 operations need separate assessment: (a) fixed channel116 Studio
published/draft inventory GET/HEAD; (b) native draft/edit/cover/submit for the exact
accepted1002 artifact; (c) native same-object readback, including any image-byte
read used to verify cover. Permission for one operation cannot imply the others.

No inspected tool or existing Planner service supplies an authoritative answer
about that refusal's applicability to these operations. No clearance API/owner
is invented. Portfolio OS owns collecting the original denial and any already
available authoritative tool-policy scope clarification, and returning the exact
source/operation/outcome assessment to this chat and owning Publisher. If none
exists, the missing policy scope remains explicitly UNKNOWN; obtaining a provider
clarification is outside this chat's internal-messaging authorization. Human GO
alone is not that evidence, and there is no probe to infer it experimentally.
Portfolio OS is a coordination owner, not a policy exception/clearance authority;
it cannot grant an exception or contact an external provider without human
outreach authorization. It may check retained tool evidence and supported existing
procedures only. No such procedure is established by this packet.

Therefore the application slice fixes the app's custody/durability defects but
does not guarantee task1002 publication. Native operations remain blocked while
their applicability is unresolved. There is no additional engineering service
to provision to resolve that unknown. This is a real external-scope evidence gap,
distinct from the removable application admission placeholder.

## TRUN: actual baseline only

Clean isolated ffe3435, synthetic loopback DB URL/token: backend build PASS;
84 existing Dzen/native-inventory/manifest/MCP tests PASS, zero skipped;
quality gate PASS77/min77/no gate hard stops. No new acceptance RED/implementation
yet. Installation found12 baseline advisories (3 moderate,8 high,1 critical).
Critical transitive proxy-addr GHSA-jqcg-44mw-7w3h requires reachability assessment
before deployment; quality score does not resolve it. No dependency changed.

No production DB/session read, provider call, commit/push/deploy, release/attempt/
fact mutation or UAT. Independent review and exact human verdict remain pending.
