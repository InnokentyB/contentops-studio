# P10-PERSONAL-REL-001 — consolidated exact X/Threads release proposal

## 1113 exact browser lifecycle — 2026-10-15

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
