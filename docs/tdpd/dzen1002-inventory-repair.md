# DZEN1002-INV-001 — bounded read-only inventory repair

Owner approval: Portfolio HQ handoff 2026-10-13 reports the direct human reply
«Да, передавай тестирование на разработку» to the diagnosed defect and minimal fix.
This approval covers only the following LOCK/QAR/ARCH/RISK boundaries.

- LOCK: task1002 exact released rev3/decision300/asset151/channel116 only;
  read Published and Draft separately before asserting exact-title absence.
- QAR: maximum10 pages per segment, 1000 unique objects overall, 60 seconds
  overall; every attempted page reports segment/page/HTTP status/count/coverage
  reason without secrets. Unknown pagination, missing title/identity/state,
  partial failure or limit exhaustion fails closed. No automatic retries.
- ARCH: a separate task1002 enumerator and browser lifecycle, selected only by
  this task's existing authenticated preflight. Other task readers unchanged.
  The oversized task service receives only a small routing/diagnostic seam;
  no material logic is added there and no broad decomposition is attempted.
- RISK: fixed provider host/path, GET-only network interception, bounded
  responses, no raw payload/errors/headers/cookies/query logging. Preserve
  owner/tenant/exact-package guards, release, idempotency and uncertain freeze.
  No migration, new credential, publication, release or provider write.

Scenarios INV001–INV008: multi-page both segments; unknown pagination/cursor;
duplicate exact title; missing title; partial HTTP failure; page/object/time
limits; repeated IDs/no progress; diagnostics secret exclusion. Existing route
tests cover authority/exact-package/duplicate classification and persistence.
Offline fixtures prove deterministic behavior only; current provider pagination
schema and authenticated session need a fresh p10 Publisher preflight after deploy.
Owner UAT remains separate. Rollback restores the previous artifact; keep all
existing task/audit/attempt records, and never turn incomplete proof into absence.

## Owner-approved delta — 2026-10-13

Ops handoff from `01a0c579-1ac5-7011-b7be-a99fd03cda8b` confirms direct
Portfolio HQ approval for the bounded adapter repair and common Dzen/VK route.
LOCK: select native `drafts` for draft reads when present; retain explicit row
identity/title/state validation. QAR: existing limits and no-retry remain;
diagnostics expose both collection counts but no rows. ARCH: task1002-only
collection selection reuses the existing row parser; shared bootstrap and central
fallback guard reuse the existing VK contract. RISK: malformed drafts fail
closed, explicit site/action denial persists across adapters/processes; no live
provider call, publication/release/job/fact mutation or credential change.

INV011–INV013 and SHAPE006 use collection names observed in the sanitized
native capture after main@4ddad2b; row values are synthetic, not native evidence.
Existing pagination tests continue requiring explicit hasMore/total evidence.
The captured provider response has neither: exhaustive end-of-list semantics
remain BLOCKED pending permission-allowed native evidence. A short/empty page
is never accepted as exhaustive; this repair does not unblock publication.

## Development continuation — 2026-10-14

Status: OPEN / NATIVE_CONTRACT_EVIDENCE_REQUIRED, not completed by PR141 or
its offline test suite. Owner directive «Отдавай чётко в разработку» relayed by
Portfolio HQ `01a041f1-23c2-7092-a53a-4d4141a55a62` authorizes continuation
of this same defect. Implementation owner: ContentOps Planner development
(this repository maintainer); operational evidence owner: AnalystCraft Ops /
the permitted independent Dzen adapter operator. No parallel duplicate defect.
Governed engineering issue: [#142](https://github.com/InnokentyB/contentops-studio/issues/142).
Ops confirmed no newer fixture on 2026-10-14. Existing sanitized native-shape
artifact SHA-256: `eb913403817ba1780992c53c06f37db903118d5e886ebec64366965f74369208`.
It records pinedPublications only as array, not count/row schema or end proof.

LOCK: exact p10/task1002/rev3/asset151/channel116; investigate native published,
draft and pinned collections and provider-observed end-of-list. No task body,
date, release, manifest binding, fact or attempt change. Current safe slice only
blocks exhaustive absence for unverified nonempty/malformed pinedPublications
and projects its count without rows. QAR: existing10page/1000object/60second/
2MiB bounds, dedupe, cleanup, explicit errors and no retry remain. ARCH: retain
task1002 enumerator/registered adapter seam; no new browser/process/tool route.
RISK: no provider calls from development under current denial; no automatic
owner attestation, raw HAR, tokens, cookies, identifiers or payload secrets.

### Acceptance criteria for the open defect

1. Retain an actual sanitized fixture from a permission-allowed native adapter
   observation, including published/draft/pinned row structure and the real
   continuation/end mechanism. Record provenance and capture limits.
2. Validate identity/title/state per owned object; account for pinned duplicates
   by the same provider identity, not title alone. Do not infer pinned row type
   from the field name. Promotion cards are not assumed to be owned objects.
3. Prove exhaustive coverage by the observed contract for both states and pinned
   semantics. No short-page, zero-page, count13/pageSize30 or repeated-page guess.
4. Positive replay uses the actual contract; negatives cover partial/malformed
   payloads, unknown state/title/id, paging conflict, failed page, duplicates,
   limits and unverified pinned collections. No secret leakage.
5. Run focused regression, source-mapped full suite, builds and quality gate;
   deploy only within approved boundaries. Preserve exact owner/revision/fact/
   attempt guards. Independent permission-allowed readonly verification and
   explicit owner UAT are separate; no live publication in this issue.

### Permission-gated operator evidence steps

1. Resolve the affected site/action denial in the permitted operator context.
   If denied or permission unknown, STOP and return the fixed permission blocker.
   Owner development approval is not provider admission. Never switch browser,
   worker, API, agent or chat to bypass denial. No Codex CUA/manual fallback.
2. Read Planner metadata for the exact package and manifest without provider
   access. If binding is stale, STOP for owner revalidation; do not rebind or
   release automatically. Do not call any publish/send/resume/reset command.
3. Only if admitted, invoke the documented registered-adapter readonly preflight
   once. Retain current sanitized diagnostics, both collection counts and limits.
   The existing reader cannot observe a native continuation without recognized
   metadata; it must return PAGINATION_UNKNOWN, not manufacture coverage.
4. If that fixture still lacks the native end mechanism, stop. Do NOT manually
   scroll a personal tab or guess offset/cursor requests. Propose a separately
   approved adapter-owned diagnostic seam before collecting further evidence.
5. Any admitted capture must keep GET/HEAD-only enforcement and existing limits.
   Export JSON, not HAR: task/revision/asset/channel binding, adapter/version,
   permission outcome, capture time, state/page index, fixed origin/path, numeric
   paging controls, continuation-present/type (no token value), HTTP status,
   collection names/counts, row field names/types, explicit state booleans/enums,
   title-present/exact-target-match booleans and stable local surrogate object IDs
   preserving cross-page/collection equality. Never export titles, bodies, raw
   IDs, headers, cookies, tokens, signed URLs or continuation strings.
6. Record how the native client requests next pages and recognizes end, including
   a sanitized code/response rule and pinned handling, not merely an operator
   statement that everything was loaded. Partial/bounded observation remains
   incomplete. Fixtures alone do not grant publication authority.

### Approval boundary if additional instrumentation is needed

Proposed, NOT implemented: LOCK — diagnostic-only observation of native list
continuation/end for this package; QAR — existing bounds and sanitized artifact
fields above; ARCH — one seam inside the same registered independent adapter,
no CUA/CDP injection/new credential or alternate transport; RISK — provider
admission checked first, GET/HEAD only, no publish/read-notification mutations,
no attestation proof, no task/release/fact writes, cleanup and fail-closed timeout.
Human LOCK/QAR/ARCH/RISK approval and permission admission are both required
before expanding this seam. If no observed contract is supplied, the defect stays
open; deployment of the protective slice is not a completeness fix.

## Readiness / owner decision packet — DZEN1002-NATIVE-DIAG-001, 2026-10-14

Owning ACK: Planner development owns #142; VK #143 remains with its existing
VK maintainer. Status: OPEN / NOT OPERATIONALLY ACCEPTED. This packet proposes
the additional diagnostic slice; it is not a LOCK/QAR/ARCH/RISK verdict.

### Recorded verdict — 2026-10-14

Portfolio OS relayed the direct human answer to this exact packet:
"Утверждаю пакет #142" (source chat01a0df21-ea6c-71f2-9c1b-40393de0e105).
LOCK/QAR/ARCH/RISK for DZEN1002-NATIVE-DIAG-001 are APPROVED exactly as below.
This is engineering authorization only. Existing provider/tool denials remain;
no live admission, manifest rebind, publication or operational UAT is implied.
Independent live verification must still use a genuinely permitted context.

Approved slice scenarios: DIAG001 unavailable/denied/expired admission => zero
session access or capture; DIAG002 foreign/stale package => zero capture;
DIAG003 admitted deterministic fixture => bounded sanitized collection/row
shapes and local candidate equality, never provider/end/absence proof;
DIAG004 secret/raw-title/raw-ID/cursor exclusion; DIAG005 page/object/response/
time limits and errors => incomplete, no retries; DIAG006 existing browser
reader emits observations from responses it already receives, no added requests.
Production diagnostic entry remains disabled until a trusted runtime admission
source exists; caller-supplied config flags are not an admission source.
Current task route also pins manifest4bfec7 while the independently read current
p10 manifest is cc2cc6: STALE_MANIFEST must stop; this approval does not permit
rebinding it. Native-end proof and positive permitted live UAT remain unavailable.

Implementation slice: an in-memory bounded native response-shape collector now
adds native_contract_observation to the existing inventory_diagnostics path.
It observes only responses already read by the existing adapter; no extra
navigation/fetch/next-page request is introduced. Row field types are allowlisted,
raw candidate IDs become local equality references, title comparisons emit only
booleans (or UNKNOWN/null when no target exists), and ownership/end/coverage
verification remain false. Diagnostic limits fail closed and do not retry.
The separate readDzen1002NativeDiagnostic adapter entry is explicitly DISABLED:
missing legitimate runtime admission raises ADMISSION_SOURCE_UNAVAILABLE before
any config-cookie access/browser launch. Config PERMITTED flags cannot clear it.
No new MCP tool/public permission surface is advertised while admission is absent.
The legacy ordinary reader's admission guarantees are not expanded or claimed
by this diagnostic-only entry; the canonical no-provider-denial-bypass rule remains.

TRUN: initial admission/capture absence RED; existing-preflight observation gap
separately RED before wiring; source focused GREEN31/31 and backend build PASS.
All inputs were synthetic/mocked; positive native end/owned pinned contract was
NOT fabricated. Full regression/quality/CI/deployment recorded separately when
complete. This is not operational acceptance or a publication-readiness proof.

**What works:** registered Planner-owned task1002 preflight selection; separate
published/draft collection parsing; bounded, secret-free counts/shape diagnostics;
fail-closed authentication, invalid state/title/identity, unknown pagination,
unverified pinned collections and limits; no generic Codex-browser fallback.
These are code/control-plane properties, not proof of a working provider session.
PR144 protective guard shipped in 80a27d3 and remains in later merged releases.
Existing test rerun on 2026-10-14: 25/25 PASS, zero failures/skips; four source
test files dzen1002_inventory, inventory_auth, inventory_boundary and
pagination_shape. This rerun used synthetic/mocked inputs, no live provider.

**Exact defect:** native evidence lacks owned pinned row identity/title/state
and the actual continuation/end rule. The stored sanitized native-shape artifact
eb913403817ba1780992c53c06f37db903118d5e886ebec64366965f74369208
does not establish those rules. PAGINATION_UNKNOWN / PINNED_COLLECTION_UNVERIFIED
must remain incomplete, never absence or cookie-expiry diagnosis.

### One approval question (four explicit verdicts)

Approve DZEN1002-NATIVE-DIAG-001 with the following bounded gates?

- LOCK: diagnostic-only native observation for p10/task1002/rev3/decision300/
  asset151/ch116; no text/date/channel/manifest/release/job/attempt/fact changes.
- QAR: at most10 pages per state,1000 unique objects overall,60seconds overall,
  2MiB per response, no retries; bounded cleanup. Export JSON field names/types,
  counts/status/page controls, continuation presence/type (never value),
  title-present/exact-match booleans and equality-preserving local surrogate IDs.
  No HAR, raw IDs/titles/bodies/cookies/tokens/headers/signed URLs.
- ARCH: one diagnostic seam in the SAME registered independent adapter reached
  through documented Planner control. No new browser/worker/API/chat route,
  CUA/CDP/session injection or credential. No guessed page requests/end rule.
- RISK: trusted applicable action admission must pass BEFORE session access;
  explicit site/action denial cannot be overridden by owner consent. GET/HEAD
  interception only; no publish/upload/notification-read mutations, attestation
  proof or task/release/fact writes. Unknown/started/uncertain never resend.

Engineering approval and actual runtime admission are independent prerequisites.
No new diagnostic command is implemented or advertised as runnable by this packet.

### Next slice, checks and independent acceptance

After explicit four-gate approval: finalize scenarios, RED at the registered
Planner/adapter boundary (denied/missing admission proves zero session/provider
access), then implement minimal capture, sanitization and cleanup. Negatives
must cover foreign/stale package, auth challenge, partial/malformed collections,
unknown end, pinned identity mismatch, duplicate/no-progress, timeout/size limits
and secret leakage. Positive contract replay must use an admitted actual fixture,
not invented fields. Run focused tests, quality gate, builds and CI before deploy.

Independent evidence owner: AnalystCraft Ops / actually permitted independent
adapter operator; human UAT owner: Innokenty. Positive LIVE readback: NOT COLLECTED.
Negative LIVE readback: NOT COLLECTED in a permitted context. Existing mocked
negative proofs are not live negative acceptance. No permission-clearing authority
or newly admitted context was supplied to development with this handoff.

### Current supported operator instruction

1. Human approves/rejects the four engineering gates; identifies a genuinely
   permitted operator context and trusted applicable admission source. A new
   token, login, generic GO or owner-written PERMITTED flag does not clear denial.
2. Operator reads exact Planner package/current manifest without provider access;
   stale binding stops for owner revalidation, never automatic rebind/release.
3. ONLY after genuine admission, use the existing documented read-only command
   ba_preflight_dzen_task1002 once through the registered adapter. If denied,
   admission unknown or evidence incomplete, stop with its exact sanitized cause.
   This packet does not authorize running it from a prohibited context.
4. Do not manually scroll personal tabs or guess continuation requests. The new
   capture surface requires the above approval and verified deployment first.
5. Operator retains time, adapter/deployment version, exact package binding and
   positive/negative sanitized readbacks. Owner explicitly accepts UAT only when
   published/draft/pinned coverage and native end are independently demonstrated.

Publication remains a separate sole-Publisher action under exact existing GO and
permission; fixture/test/deploy/receipt is not a publication fact. Until admitted
native evidence and UAT exist, #142 remains open. Rollback is code-only and
preserves all existing audit/release/lease/attempt/fact history.
