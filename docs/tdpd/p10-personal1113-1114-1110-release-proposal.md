# P10-PERSONAL-REL-001 — consolidated exact X/Threads release proposal

## X1113-NATIVE-002 — bounded decision packet, PROPOSED 2026-10-15

This section is a proposed change to ARCH/RISK146, NOT approved implementation,
installation, permission grant or send. PR154 stays Draft with all three P1s open.
No new architecture code is authorized by this packet. Existing release approval
for the accepted1113 package is preserved; it is not a standing publication GO.

### Evidence: the exact missing hook

At code132867c, `x1113_tools.ts` directly calls `preSubmitX1113` with caller fields.
`executeX1113NativeSubmit` accepts injected read/click callbacks but is called only
by tests; it has no production native-provider binding. `checkX1113LiveContext`
validates a normalized BrowserInfo object supplied by the caller. A profile tag,
fresh timestamp or recomputable SHA cannot authenticate its origin. The exposed
CUA BrowserInfo API supplies profileName and ephemeral browser IDs, not a signed
runtime receipt or a server-verifiable final-click hook. No trusted hook is
registered in this repository. This is an inspected gap, not a claim that CUA
cannot show the correct profile to the owning Publisher.

Do not invent an app RPC, wrap a caller assertion in another hash, patch the
vendor Codex app/extension or describe a test callback as admitted execution.
Development never inspects or drives the personal X browser. Dzen/VK denials
and adapter-only routes remain outside this proposal and unchanged.

### LOCK-X1113-NATIVE-002

Pilot only p10/task1113/channel164/@naraHeTc, accepted rev1, existing exact body,
decision308v1, null asset and both original dates. One task, one browser WI,
one attempt and at most one native Post invocation. No X API, paid service,
credential import/export, browser-session injection, working-profile fallback,
new queue or schema migration. Preserve existing owner GO, audit and idempotency.

Proposed component: one small first-party X-only browser extension, installed
once by the human in the personal browser profile labelled Innokenty. It is a
new trusted local execution boundary, explicitly requiring architecture/risk
approval. It is not a new browser daemon or a component per post. Existing vendor
CUA is not forked. An event-driven extension background component and X-page
content script own native DOM reads, the final click and result readback.
Do not claim that the existing CUA connection already implements this bridge.

### ARCH-X1113-NATIVE-002

Enrollment and rights:

- Human installs/enables a reviewed packaged build in only the personal profile;
  it stays off until explicit enrollment. Request only X-page DOM access and
  HTTPS access to the fixed Planner execution origin. No cookies API, history,
  all-sites access, filesystem, native messaging, arbitrary JS evaluator or
  externally callable message endpoint. No automatic login or CAPTCHA handling.
- Generate a non-exportable signing key inside extension origin; persist its
  key handle locally, never in chat/config/env or page context. Planner stores
  the public key/fingerprint and an audited owner-approved installation binding.
  Use a supported browser cryptographic store; persistence/permissions must be
  proved by a no-send compatibility spike, not assumed from a mocked test.
- Human pairs that installation using a short-lived one-time challenge, sees
  the public fingerprint and native current X account, and approves only
  p10/channel164/@naraHeTc. No publishing OAuth or provider cookie leaves browser.
  The label Innokenty is explanatory; possession of the enrolled installation
  key plus actual native account readback is the binding. The working profile
  has no enrolled key and cannot acquire admission by naming itself Innokenty.

Execution, using the existing governed lifecycle:

1. Publisher requests execution of the already released exact WI through Planner.
   This request is not a click permission. Existing owner/project/GO/package/
   manifest/lease gates remain. No normal Publisher RPC returns a raw reusable
   submission_permitted=true. Remove or deny raw start/preSubmit/confirm bypasses.
2. The enrolled extension retrieves only that authorized WI and a one-time
   server challenge. It constructs observations itself from the selected native
   X page: account, exact editor text, new-post mode, zero attachments, enabled
   Post and bounded duplicate history. It never signs observations supplied by
   an agent or webpage. Missing/incomplete native evidence blocks, not empty.
3. A signed challenge response binds installation, tenant, task, channel, WI,
   actor, immutable package SHA/revision, release/send keys, manifest, phase,
   nonce and expiry. Server validates registered public key, revocation, purpose,
   exact package and nonce consumption before creating the sole pending attempt.
   Persist nonce/receipt hashes and execution states in the existing bounded
   workflow audit, not a parallel delivery queue. If existing persistence cannot
   provide atomic uniqueness, return to ARCH approval before any schema change.
4. The extension re-reads native account/editor/tab immediately before Post.
   A single-use signed final challenge is consumed atomically for that attempt;
   the permit is returned only to the paired executor, expires within15s and is
   never exposed as an agent-callable click authority. The local durable journal
   records click-start before exactly one invocation. No retry on timeout/crash.
   Renavigation, account switch, hidden/disabled editor, hold, revocation or
   package drift blocks. Recheck current server authority just before click.
5. The same extension reads the resulting native status, not merely composer
   disappearance: exact author, status ID, canonical URL, actual native timestamp
   and accepted text under one documented whitespace-only normalization. Content,
   URL and time must come from the same object; no arbitrary evidence hash or
   user-supplied timestamp is sufficient. A signed result receipt binds this
   object to the original attempt/challenge/package. If timestamp or text cannot
   be verified, remain UNKNOWN; do not derive it from the requested slot.
6. Internal verification atomically validates the signed result and original
   attempt, then writes delivered attempt/audit/canonical fact. Normal Publisher
   may read the receipt/fact, not forge an internal native confirmation. Existing
   manual fact form must not bypass this contract. Receipt alone is not success.

The signing key proves the enrolled software installation, not an independent
X server attestation or protection against a compromised local OS. Review the
extension code/package and enrollment as the new trusted computing boundary.

### QAR-X1113-NATIVE-002

- Safety targets: zero duplicate clicks, false facts, cross-tenant admissions,
  working-profile sends, raw credential logs or unreviewed capability expansion.
- Native observations at start/final gate age<=30s; final permit TTL<=15s;
  single-flight1 per installation/account; no provider mutation retries.
- Active execution uses bounded heartbeat (at most one per60s) and a30min lease.
  Bound result readback to120s and at most20 native statuses; partial/history gaps
  remain UNKNOWN. Report actionable blocked/unknown status within120s after the
  executor detects failure; no guarantee that X accepts a post.
- RED scenarios: direct raw MCP preSubmit/confirm; forged or replayed receipt;
  unpaired/revoked/wrong-profile key; wrong actor/tenant/account; stale nonce/
  manifest/revision; wrong text/media; duplicate/incomplete history; disabled Post;
  simultaneous execution; crash before/after click; lost permit/result response;
  unrelated numeric status or fabricated time; expired lease before/after start;
  DB rollback/CAS conflict; secret-bearing errors; disabling extension mid-flight.
- Tests first with deterministic native ports; real isolated PostgreSQL races
  for nonce/attempt/fact transactions; backend/build/quality gates. Then explicit
  owner no-send UAT of enrollment/profile mismatch, followed by exact1113 live
  UAT in the owning operational context. Development never clicks Post.

### Lease expiry and uncertainty (closing the third P1)

Before any attempt OR final permit: audited same-WI/same-actor renewal with exact
old expiry/fence fingerprint and CAS; preview default, no new claim/release/WI.
Any existing attempt/permit forbids this pre-execution renewal. Same-key replay
returns the same fence/expiry, never another extension of authority.

After an attempt or click-start: lease expiry must NOT prevent truthful
reconciliation and must NEVER grant another Submit. Freeze pending/unknown,
retain historical fence SHA, installation identity, original package and keys.
Issue a new short-lived READ-ONLY challenge scoped to that original attempt,
authenticated by its enrolled executor and current authorized owner. It can read
native result/history and admit one matching signed result but cannot rotate
send authority or invoke the submit path. Ambiguous/zero/partial matches remain
UNKNOWN. Concurrent confirmed replay returns the existing canonical fact. Drift
of the task or executor binding quarantines evidence for explicit reconciliation,
not automatic rebinding. No lease clear/cancel/new claim to recover uncertainty.

### RISK-X1113-NATIVE-002 and rollback

High reliance: public personal publication is hard to reverse. A native extension
is security-sensitive new access; installation/enrollment require explicit human
approval. Compromised OS/browser/extension or deliberate profile-data/key cloning
is residual risk, not solved by a profile label or non-exportable key handle.
No signing key in the page/content script, arbitrary signing endpoint, or broad
Planner bearer in the extension. Pairing uses only bounded executor capabilities;
keys are revocable. Standard TLS, strict origins, CSP and input schemas apply.
Logs contain IDs/status/codes/checksums only; no cookies, tokens, authorization
headers, full page HTML/feed or unrelated private content. Evidence storage is
scoped/private and minimizes capture to the confirmed post; define retention at
implementation review before capture, not by silently saving the whole screen.

Rollout flag off by default, allow only1113 after no-send UAT. Disable executor
admission and revoke its key to stop new permits, then disable/uninstall only
this extension. Preserve WI/leases/attempts/releases/nonce and receipt audit/facts.
Already issued or consumed click authority can be in-flight; rollback is not a
promise to undo a post. Such attempts remain reconciliation-only. Never delete
history or automatically fall back to CUA, another profile, API or another chat.

### Reuse, scope and the requested decision

This is one reusable native-execution boundary attached to existing Planner
work/release/attempt/fact primitives, not a new component per publication. The
initial allowlist stays1113. Later X tasks need their ordinary package-specific
GO and policy eligibility, not a new installation or architecture approval per
post. Adding another provider/profile, broader extension permissions or schema/
queue requires a separate material-scope review. No paid X API is introduced;
existing platform restrictions/rate limits still apply.

Requested verdicts: LOCK-X1113-NATIVE-002, QAR-X1113-NATIVE-002,
ARCH-X1113-NATIVE-002, RISK-X1113-NATIVE-002. Approving these permits bounded
test-first implementation and the no-send compatibility/enrollment UAT, not
development provider sends. Rejection leaves154 Draft and1113 held; existing
Threads publication and LinkedIn1128 same-WI recovery are independent.

### LinkedIn1128 client-catalog refresh handoff (not OAuth)

Only configured connection `contentops_seturon_p7_publisher`, displayed as
Contentops_seturon_p7_publisher, needs tool rediscovery in the owning Publisher
chat `01a06dbc-7cf1-7d83-8ddd-2a0539f2a3d6`. Fixed URL:
https://planner-mcp-production.up.railway.app/mcp/publisher . Keep its existing
CONTENTOPS_SETURON_P7_PUBLISHER_TOKEN env reference; never copy its value.
No planner/editor/art-director/p10 connection or provider OAuth change is needed.

Official supported app-server operation is `config/mcpServer/reload` (reload
configuration/queue refresh for loaded threads), then `mcpServerStatus/list`
filtered by serverName and threadId with toolsAndAuthOnly detail. The reload
operation is not documented here as server-filterable: do not invent parameters
or promise its refresh is limited to one server. This is catalog rediscovery,
NOT restarting chats/processes or reauthorizing LinkedIn. A fresh independent
SDK tools/list already sees renewal; that does not refresh the existing chat.

Current agent tools expose neither the app-server reload nor a plugin refresh
operation. Codex UI access was explicitly denied by Computer Use; no alternate
UI/IPC process may bypass that denial. Thus client refresh was NOT performed.
In the supported app UI, target only that existing MCP connection's refresh/
rediscovery action if offered; exact button wording in this installed build is
unverified. Do not uninstall/recreate the connection, alter tokens, toggle every
plugin, start OAuth, edit config merely to trigger reload, or restart all chats.
App operator must use the supported reload surface and verify that the original
Publisher chat discovers `ba_renew_linkedin_task1128_browser_lease` with apply
defaultfalse and expiry/SHA inputs. If that surface is absent, request a screenshot
of this connection's menu rather than invent a click path.

After confirmed discovery, the owning Publisher previews and applies recovery
on SAME WI1924/actor/original package using one stable renewal key and the exact
preview expiry/SHA. New fence stays private; continue original submission key.
Do not bind/release/claim again. Production153 merge10a6bee and both deployments
are verified SUCCESS; publication fact for1128 remains absent at last readback.

Official references inspected2026-10-15:
https://learn.chatgpt.com/docs/app-server (config/mcpServer/reload and scoped
mcpServerStatus/list); https://developers.openai.com/plugins/build/mcp-server
(refresh custom MCP connection after metadata changes). These establish the
supported operation, not an observed UI label or a completed refresh.

## 1113 exact browser lifecycle — 2026-10-15

**DRAFT / NOT RELEASE-READY.** PR154 independent review found three P1 gaps:
the native helper is not wired to a trusted callable owning executor (raw MCP
pre-submit remains bypassable), resulting-status content/time lacks trusted native
readback, and expired leases have no complete recovery/reconciliation path.
Stage-bound hashes validate consistency, not actual native-source admission.
No X production enablement/release/send occurred. The 1131 source-mapped tests,
focused mocks, build and baseline quality gate pass, but do not resolve these
findings or constitute owner UAT. Do not merge or instruct Ops to execute this
draft. A concrete owning-runtime hook is required; adding a new native worker or
transport needs an explicit architecture/risk change, not an inferred approval.

Approved issue146 implementation, not a new transport. Fresh read-only Planner
readback confirms task1113/channel164/@naraHeTc, exact accepted rev1/body269,
both original dates, active decision308v1/reviewWI1897result2/artWI1901result1,
manual-only channel and manifest cc2cc620. No live API or browser from development.

Exact controls: ba_release_x_task1113_browser → ba_claim_x_task1113_browser →
ba_start_x_task1113_browser_submission → ba_pre_submit_x_task1113_browser_submission
→ ba_confirm_x_task1113_browser_submission. Ambiguity uses
ba_mark_x_task1113_browser_submission_uncertain on the same attempt/key.
Release atomically rebuilds an English manual handoff from current channel/body,
audits GO and creates one revision-bound WI. Claim returns a private fence only
to its owning executor. Release/claim/send keys are separate stable keys;
every execution boundary carries the original releaseIdempotencyKey. No alternate
key can create another attempt. No paid API, channel config, body, date, revision,
asset or visual record is changed. Generic dispatch/fallback and generic manual
fact entry are blocked for this exact task.

Native execution contract: owning Publisher must call checkX1113LiveContext
against freshly observed native BrowserInfo + selected tab/account before claim
and start. IDs are runtime-only, never persist them as profile identity. Before
Post, executeX1113NativeSubmit performs native editor/profile validation, one-shot
server preSubmit, then a second fresh native check on the same browser/tab/URL,
and exactly one bound click callback. The callbacks MUST read/click the actual
owning native surface; stored tags, fabricated caller observations and a server
receipt alone are not admission. The server records server_browser_verified=false.
If the owning runtime cannot run the native guard, stop before attempt/Submit;
do not choose the working profile or API. Development does not run these callbacks.

Keep the pre-submit proof fields for confirmation (fresh observedAt is required
for start/preSubmit, not historical confirmation). Native readback must verify
author @naraHeTc, exact text, numeric status ID, canonical
https://x.com/naraHeTc/status/ID and actual publication time. Fact.beforeWrite
rechecks active lease/package/attempt, matches pre-submit proof and rejects an
object older than the attempt/permission minus explicit120s clock tolerance.
Delivered attempt/audit/fact are one transaction. Uncertain state permits only
reconciliation of that same identity, never another Post.

TRUN: missing lifecycle reproduced three RED assertions; generic manual-fact
bypass reproduced RED separately. Focused runtime/lifecycle/dispatcher/fact tests
pass; transaction mocks do not prove real provider access or production races.
Owner UAT/publication remains separate. Rollback removes exact registrations
without deleting or rewriting task/WI/release/lease/attempt/fact history.

Status: APPROVED for LOCK-P10-PERSONAL/QAR-P10-PERSONAL/ARCH-P10-PERSONAL/
RISK-P10-PERSONAL by direct human reply in this development chat on 2026-10-14:
«Да, даю разрешение на обе задачи», after explicit explanation of issues145/146.
No publication from development.
Implementation owner: ContentOps Planner development / maintainer InnokentyB.
Release/send owner: authenticated p10 owner and owning Publisher/AnalystCraft Ops.

Owner intent source: Portfolio HQ human turn
`01a1395f-caa1-73f3-9111-520934ee8d9c`, 2026-10-14, close today's publication
debts then prepare tomorrow. Ops supplied Registryv36 checksum
`cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7`.
Registry checksum and Planner manifest checksum are different contracts; never
substitute one for the other. Fresh sanitized Planner package/decision/manifest
evidence is required before locking new exact tools.

## Exact scope

- #1113: p10/channel164/personal X @naraHeTc; content=accepted rev1;
  body SHA `0fa60a2b064bad760b251a12ab39cf38735987dabecc57dcad1d60a46dec12e3`;
  schedule 2026-10-14T15:00:00Z (16:00 Lisbon); NO_VISUAL_NEEDED, asset null.
  A task-native release creates one owned browser WI/package. Actual publication
  uses only Innokenty's personal browser, never the working browser.
- #1114: p10/channel138/personal Threads @innokentybo/user39421253764155091;
  content=accepted rev1, body SHA
  `466b5444832d0b0fdf326461cbe7e6c3a41aab5704b9bc42697f29676f938f5a`;
  schedule 2026-10-14T16:30:00Z (17:30 Lisbon); NO_VISUAL_NEEDED, asset null.
  Own exact release plus one-shot task-native API delivery/fact path.
- #1110: p10/channel138/same Threads identity; content=accepted rev2;
  SHA `9172f6ceefe974c88caffb7b6aa84c971a3920fd5b0c281c0a6329b94825ce30`;
  unchanged schedule 2026-10-13T16:30:00Z; NO_VISUAL_NEEDED, asset null.
  Existing decision299v2/reviewWI1841/artWI1860 bindings stay unchanged.
  Existing ba_release_threads_task1110_api schema pins stale manifest4bfec7...;
  releasePendingThreadsTask already checks supplied checksum against live manifest.
  Repair only exact1110 schema/current-checksum validation; do not change shared
  MANIFEST used by Dzen1002 or task1108 and do not bypass manifest equality.

NO change to Dzen1002/1036, VK1048/1084, #1091/#1100 or p7#1128; the latter
remains its separately scoped issue. No cross-task tool or owner-proof reuse.

## Minimal approval boundaries

### LOCK-P10-PERSONAL

Task-native exact routes for these three packages only. Keep text, accepted
revision, asset-null state, decision/version, channel/identity and both original
timestamps unchanged. Separate audited owner GO and release from send. No generic
Publisher authority or permission inherited from dry-run. Release must reject
any fact, permalink, active claim/browser WI or known/uncertain delivery attempt.
The late #1110 slot is reported as debt, not silently rescheduled or backdated.

### QAR-P10-PERSONAL

Owner/principal/tenant, exact body/revision/decision/identity/schedule/manifest
checks before writes/provider dispatch; transactional CAS and idempotency bind
package, release and send keys. Replay returns same owned WI or confirmed fact;
changed arguments conflict. Concurrency allows at most one WI/attempt/send.
Uncertain provider result freezes with no fabricated fact or automatic retry;
reconciliation is required. Provider history remains bounded and incomplete
history never proves absence. Recheck the current manifest/package at claim/send,
not only at request parsing. Functional negatives cover drift, foreign identity,
wrong browser context, unauthorized principal, fact/attempt/lease conflicts,
duplicate/history gap, race, key conflict and uncertain replay. Focused + broader
source-mapped tests, builds, quality and CI required. All dev/UAT harness provider
ports are deterministic mocks; no live provider call from development.

### ARCH-P10-PERSONAL

Reuse existing canonical owner/work-queue/Threads delivery/fact/identity and
remote MCP scope patterns through narrow task-specific wrappers. New exact tools
remain proposed until approved/tested/deployed, not already available. #1113 WI
must bind owner_personal browser requirement and its task/package/identity;
actual Publisher execution must reject a working-browser context before attempt
or Submit. A prose tag alone is not enforcement or admission. If existing runtime
cannot prove required context, keep BLOCKED and surface the missing boundary.
#1114 uses task-native Threads API, never generic browser/photo or alternate-key
fallback. #1110 accepts only a caller-supplied current manifest verified by the
authenticated loader/CAS; no automatic checksum replacement in historical audit.
No new data model/queue/migration, provider transport, standing approval or broad
global release endpoint. Decompose bounded seams instead of enlarging god files.

### RISK-P10-PERSONAL

Externally visible personal publication is high reliance and hard to reverse.
No development browser/provider access, release, send, lease reset/cancel or
credential change. No working-browser substitution, alternate profile/key,
attestation-only identity proof or uncertain retry. Readiness/control-plane
receipt is not publication evidence. Provider-confirmed identity/permalink and
canonical fact required for success. Keep tokens/cookies/raw payloads/config out
of logs/audit/tests. Existing site/action denials remain binding and cannot move
to another tool/process/chat. Dzen/VK adapter policy remains unchanged.

## Evidence prerequisites and acceptance

Owning Ops supplies exact active visual decision IDs/versions and review/art
bindings for #1113/#1114, authoritative schedule_at AND publish_at, no facts or
attempts/active browser WIs, current status/mode/handoff, channel identity and
current Planner manifest checksum with observation time. Registryv36 alone
does not prove these values. Do not invent missing decision IDs/manifest.

After approved RED→GREEN and deployment, owning Publisher discovers only exact
tools and dry-run shows correct package/route. #1113 has one released WI with
personal browser requirement; #1114 exact live path is executable only with
current release; #1110 unchanged package accepts current verified manifest and
rejects stale one. Owning operational release/send after the applicable gates
and schedule remains separate from development verification. Return actual
PR/deploy/tool readiness and scope gaps; no premature GREEN or publication claim.

Rollback removes bounded new registrations/allowlists/code without rewriting
audit, task, WI, release, attempt or fact. Already released/in-flight packages
require owner hold/reconciliation, never destructive cleanup or automatic retry.

## Current gate

Approved for test-first implementation. Missing exact decision/manifest/browser
context evidence remains an Input prerequisite, not permission to invent values.
1110 schema repair may proceed independently; provider calls only belong to the
owning operational Publisher after its gates, not development.

Initial scenario P10-1110-01: owner/Publisher invokes exact1110 release with a
well-formed current manifest checksum; tool parsing accepts it, canonical loader
still compares it to live manifest. P10-1110-02: malformed checksum, foreign task/
tenant and invalid actor fail at schema boundary; Dzen1002/1108 fixed schemas
remain unchanged. P10-1110-03: actual stale manifest fails before provider reads
or writes; covered by canonical manifest guard with mocked dependencies.

## 1110 independent engineering slice — 2026-10-14

Only the exact1110 release schema changes from the obsolete literal manifest
checksum to a well-formed sha256 checksum. The canonical release service still
loads and compares the current project manifest before any provider reads or
writes. No new release/publish authority, actor/tenant/task flexibility, body,
revision, date, identity, decision, release, attempt or fact mutation is added.
Dzen1002 and Threads1108 fixed checksums remain unchanged.

TRUN: P10-1110-01 reproduced RED with a current valid checksum before the
schema change; GREEN accepts current format while malformed checksum/actor/
tenant/task cases fail at parsing. Dzen1002/1108 regressions retain their literal
contracts. Focused release/route tests: 5 PASS. The source-mapped full suite1095,
backend/frontend build and quality gate PASS included this unchanged local
slice. This is not production release, provider preflight or publication proof.
1113/1114 implementation and owner UAT remain outstanding; no live readiness
claim for those tasks. Deployment and owning Ops release of1110 remain separate.

## 1114 implementation slice — 2026-10-15 (not operational acceptance)

Exact commands implemented in this slice:
`ba_release_threads_task1114_api` and `ba_publish_threads_task1114`.
Both require project10/task1114, authenticated owner actor, pinned current
manifest, approvalReference, idempotencyKey and releaseIdempotencyKey. Publish defaults to dryRun=true.
Release uses idempotencyKey=releaseIdempotencyKey; send supplies its separate
stable send key plus the original releaseIdempotencyKey. Never change the send key to recover
an uncertain operation. Development does not call either live command.

Release validates server-derived immutable task/decision/review/art bindings
before bounded operational identity/history reads, then serializable CAS/audit.
Send rechecks release/package, rejects existing attempts/facts, performs bounded
identity/history reads, atomically claims one pending attempt with a conservative
manual-confirmation fence, and rechecks package plus credentials before dispatch.
Provider numeric ID, author, exact text, permalink and actual timestamp are read
back. Canonical PublicationFactService.beforeWrite atomically revalidates the
attempt and writes delivered status/audit together with the publication fact.
Any post-claim ambiguity leaves the existing attempt frozen for reconciliation;
there is no automatic resend, browser fallback or alternative-key recovery.
Original timestamps are not shifted; actual publication time is not backdated.

Verification: missing verified-send method and missing role capability each
reproduced RED. Backend build and quality gate PASS; focused regression 26 PASS;
store transaction-contract mocks 5 PASS. Store harness command:
`node --test --test-concurrency=1 tests/tdpd/threads1114-store.unit.test.js`.
It mocks transaction/provider boundaries and does not prove a real database race,
provider credentials, production deployment or owner UAT. No isolated test DB
was configured in this run. Independent review, CI/deployment, current catalog
readback and owning operational dry-run/publication remain required.

Rollback removes exact1114 registration/capability/runtime code without altering
release/attempt/fact history. Any existing pending/uncertain attempt remains
reconcile-only after rollback. This slice does not complete X1113 or LinkedIn1128.

Safe configuration readback on 2026-10-15: Threads ch138 active, configured
@innokentybo/user39421253764155091, API publish enabled and credential field
nonempty (encrypted presence only, not token validity). LinkedIn ch5 personal:
active, browser_required/manual, API publish disabled. Ch6 company_page:
active, API publish flag enabled but execution_modes manual only. Both expose
nonempty credential fields, not verified scopes/expiry/provider author. No live
provider authentication test was performed by development. No owner OAuth
action is justified by these unknowns; a scoped secret-free readiness diagnostic
for personal/Page is separate proposed scope, not silently included here.

Independent review on PR151 identified actor/release-key transfer, overlapping
release replay and post-completion manifest drift. Dispatch now requires the
exact releasing actor and explicit release key in the durable proof; release
rechecks replay within its serializable transaction and bounds serialization
retries to three database-only attempts. An overlapping preflight/package check
returns an identical already-recorded release rather than creating another.
Recorded replay authenticates current owner membership without requiring the old
manifest to remain current; fresh writes/dispatch still require exact manifest.
Confirmed send replay also checks the current canonical fact against its proof.
RED reproductions were added for overlapping release and manifest drift before
their fixes. CI uses a nonfunctional synthetic Telegram token solely because
legacy module import initializes TelegramService; no provider calls are made.

Manifest/package mutations now pass their serializable transaction reader into
the shared compatible manifest loader. CI additionally provisions a dedicated
ephemeral PostgreSQL16 service for the release/claim race test. That test refuses
any fallback DATABASE_URL, non-CI context, non-loopback host, wrong database name
or preexisting fixture project. It mocks identity/package acceptance only to
isolate real database CAS/audit concurrency; it performs no provider calls and
does not replace identity tests or owner UAT. Local Docker was unavailable, so
real PostgreSQL evidence is a CI gate, not a claimed local result.
