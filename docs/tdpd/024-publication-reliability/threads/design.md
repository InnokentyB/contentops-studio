# Threads API delivery reliability — approval packet

Status: OWNER APPROVED for synthetic implementation on 2026-10-19 («Утверждаю пять пакетов»). Live capability admission, provider UAT and rollout remain separate.
Date: 2026-10-19. Inspected source: `3fd625a3b5ecce44fd6956ec0d1355e5ed3ff3e4`.
Method: TDPD / Test-Driven Product Development, an original method by Innokenty Bodrov.

## Source map and actual gap

| Source | Established behavior / limit |
|---|---|
| `src/mcp/tools/task_publication_tools.ts:281` | `ba_publish_threads_task` selects generic service only when all generic release arguments exist; otherwise historical exact-task service. A newly added recovery operation must never fall through to that legacy sender. |
| `src/services/threads_generic_release.service.ts:52` | Owner membership, manifest, revision, visual, review, hold, existing attempt and fact guards. Despite its name, current generic implementation restricts manifest to one project/slug; this is existing business-specific debt, not a reusable contract to copy. |
| Same file, `providerPreflight` | Reads profile then at most five own-post pages; exact body hash blocks a duplicate. Exhaustion is required, so more than 500 historical posts can block an otherwise ordinary new task. No timestamp-bounded completeness proof exists. |
| Same file, `publish` | Serializable task claim + pending DeliveryAttempt precede dispatch. Any failure in dispatch checks or provider operation becomes uncertain. No phase-specific persisted evidence distinguishes definitely pre-submit failures from an in-flight send. |
| `src/services/threads.service.ts:79` | Container creation, publish and permalink execute as one operation. Container and published post IDs live only in memory until complete success. `publishVerifiedText` adds a 30-second abort and identity/text/URL/time readback checks. |
| Generic service, canonical fact call | Fact write occurs after provider result. Failure here leaves a pending attempt without durable provider IDs, even if publication succeeded. New send is blocked, but no generic API reconcile command repairs it. |
| `src/services/threads.service.ts:143` | Existing direct post GET and bounded-page own-post GET are usable read-only building blocks; missing/malformed paging is rejected. Runtime JSON remains unchecked beyond limited guards. |
| `prisma/schema.prisma:1080` | DeliveryAttempt stores no provider container/post ID or dispatch stage. WorkflowEvent can retain safe historical events, but is not a sufficient concurrency/fence/budget row. |
| `prisma/schema.prisma:1317` | BrowserDeliveryRecovery requires a browser work item and browser lifecycle contracts. Threads API attempts have no such item; do not fabricate one or reuse browser authority. |
| `src/services/publication_fact.service.ts` | Canonical fact writer supports `beforeWrite` and `beforeCommit`; atomic attempt/state/fact/audit completion can reuse these hooks. Current browser transaction guard must remain intact. |
| `src/services/threads_task_publication.service.ts`, `threads1114_*`, `publishers/publication_dispatcher.ts`, `publishers/legacy_post_publisher.ts` | Other historical text/image/chain routes exist. This package cannot claim to repair them automatically or create business-ID branches to enroll them. |

No live provider calls, credentials, test runs, readiness claim or production mutation form part of this audit.

## LOCK-024-THREADS

Problem: a valid owner-released text-only feed publication can reach Threads but remain pending locally after a timeout, failed permalink/readback or DB commit. The operator must currently investigate manually because usable provider identity is lost.

Outcome: shared API publication durably journals its phases and returns a recoverable status; bounded read-only reconciliation can confirm an existing delivery and atomically record its canonical fact without another publication request.

Primary surfaces: existing generic Threads publication MCP response; a separate authenticated Threads reconciliation command; safe diagnosis projection. Reconciliation writes Planner state, so its annotations must truthfully describe local mutation even though provider access is GET-only. A strictly read-only readiness command belongs to the parallel preflight package and must not claim publication confirmation.

Scope: single text-only, no-visual feed post using an audited generic owner release. Resolve tenant-owned channel/account and exact immutable package as validated data; remove the touched generic route's fixed project/slug restriction through existing project authorization and manifest contracts, never through relaxed ownership or account checks. No incident/task/account-specific production code.

Out of scope: image/carousel/video/reply chains, historical exact-task release routes, provider deletes, new publication authority, resetting attempts, replaying queued sends, auto-enrolling old uncertain attempts, unattended startup sweeps, new browser sessions, live smoke or deployment. Legacy attempts without a trustworthy dispatch/package snapshot remain explicitly unsupported for automatic confirmation; no guessed reconstruction from the current draft.

Approval requested: this bounded design and synthetic implementation only, including additive schema. Live migration, role/tool capability enrollment, provider reads and UAT need their own concrete release envelope. The user's request to tackle six topics approves investigation, not this previously unseen lock.

## ARCH-024-THREADS

### Durable API lifecycle

Add an `ApiDeliveryRecovery` row with composite tenant/attempt uniqueness, transport `threads_api`, contract version, immutable package/release hashes, expected account ID/username/channel/revision, trusted dispatch window, state, rowVersion, generation, container ID, post ID, provider receipt times, safe error code and durable read budget/lease. Store references/hashes and exact accepted text only through existing protected source records; do not store token, approval reference, cookies, raw responses or URL query secrets. A dedicated additive migration is necessary; do not overload error_message or browser work IDs.

States: `claimed` → `container_create_started` → `container_ready` → `publish_started` → `provider_id_recorded` → `readback_verified` → `confirmed`. Recovery transitions can enter `uncertain`, `readback_pending`, `blocked`, or `conflict`; these do not grant send permission.

Create row + pending attempt + claim audit atomically. Persist a pessimistic phase fence BEFORE every mutating provider request. Persist a validated numeric container ID BEFORE any publish request, and a validated post ID immediately upon publish response BEFORE permalink or other GETs. If persistence fails, stop; no following side-effect request is allowed. `auto_publish_text` must remain absent/false: container creation must not silently become publication.

Gate immediately before publish: tenant, current membership/capability, accepted package, release, active account, hold, schedule, attempt identity and generation. Persist `publish_started` under CAS before network dispatch. Once reached, neither crash, missing HTTP response, 429/5xx nor incomplete history allows another POST. Never claim atomic exactly-once behavior between database commit and external provider.

Before that fence, a proven not-yet-dispatched operation may continue the same attempt with the same saved container only while old executor quiescence and current authorization are established. No generic retry of container creation in this initial slice; a lost create response may leave an orphan container. A durable pre-publish fence alone is not proof that an old process cannot subsequently dispatch; generation checks and lease quiescence must serialize execution. Unknown pre-fence evidence stays blocked.

### Read-only recovery

Use a separate provider port exposing only profile, container status, direct post GET and own-post GET. It cannot access create/publish functions. Profile must identify the original expected account. Inject current tenant-scoped credentials at runtime; a credential rotation is permitted only if account identity is unchanged, never by matching token strings.

1. If post ID is durably known, read that exact object. Validate numeric ID, exact account username plus authenticated account identity, exact body/hash under versioned comparison (initially exact text only), valid canonical HTTPS permalink without credentials/query/fragment, valid provider timestamp inside the trustworthy dispatch observation window. Exclude reply/chain objects; request/validate provider fields needed to establish top-level TEXT identity rather than relying on current getPost's minimal field set. A public URL or container status alone is not publication proof.
2. If only container ID is known, GET its documented status. `PUBLISHED` is positive container-stage evidence, not a canonical post identity or URL. Never call `threads_publish` as a status check even if a documentation paragraph ambiguously suggests POST. Without a documented original-container→post mapping, bounded own-post discovery can provide candidates only.
3. A body/account/time match in recent history alone cannot uniquely bind a missing-ID post to the original attempt (manual identical posts are possible). Return `candidate_requires_verification` rather than auto-writing a fact unless a reviewed provider contract establishes independent correlation. No text marker or user-visible tracking edit is introduced. History absence, ERROR/EXPIRED and FINISHED do not authorize resend.
4. No result, multiple candidates, malformed/cyclic paging, expired/unavailable history, account mismatch or budget exhaustion retains UNKNOWN with the exact reason and supported role/action. Complete visible inventory still does not prove non-delivery under delayed visibility.

Proposed shared recovery budget: at most 3 read rounds at offsets 0/30/120 seconds, 20 total provider requests, 180 seconds overall; every request/cursor consumes the same persisted budget, with per-request deadline/cancellation. Container-status polling must additionally respect the verified provider interval; pending documentation verification it remains capability-disabled, not polled every 500ms. Reinvocation cannot reset budget. A recovery crash conservatively consumes its reserved requests. This initial slice resumes only on supported invocation and does not add a scheduler; autonomous continuation after a process dies is therefore not promised.

For automatically scheduled reads within one invocation, caller cancellation stops provider requests and leaves durable status. Later authorized read-only continuation uses only remaining budget. Existing explicit caller/tool denials are never bypassed by another session, worker or account.

### Confirmation and races

One canonical finalizer for normal success, readback recovery and late response. Within the canonical fact transaction revalidate tenant/current guard requirements, original snapshot, attempt/generation, observed identity, lease/version, absence of conflicting fact and provider-object reuse by another attempt/task. Write attempt delivered, recovery confirmed, fact and audit together; beforeCommit checks cancellation/fence. Matching replay returns the committed fact; conflicting identity holds for investigation without overwriting or a new send. Release revocation/content change preserves the historical observation but blocks confirmation under existing authority; no implicit historical-fact exception.

Keep modules bounded: typed schemas, transport, durable store/fences, matcher, coordinator and finalizer; keep existing Threads service below structural thresholds and add no new `any` or silent catches. A pre-send guard failure must preserve its actual safe code, rather than being mislabeled provider uncertainty. A failed post-send DB write returns `THREADS_FACT_COMMIT_PENDING`, original attempt, no retry authority and the supported reconcile action.

### Operator contract examples

| Stable code | Plain meaning / supported action | Send allowed? |
|---|---|---|
| `THREADS_READBACK_PENDING` | Provider identity saved; system is checking the existing post within the remaining read budget. Read status; no new GO required for the already authorized lookup. | No |
| `THREADS_FACT_COMMIT_PENDING` | Threads result was observed but Planner could not commit confirmation. Reconcile the existing attempt after DB service recovers. | No |
| `THREADS_RECOVERY_IDENTITY_UNAVAILABLE` | Original post ID was not durably obtained. Inspect protected candidate evidence; engineering must establish supported correlation. | No |
| `THREADS_RECOVERY_ACCOUNT_MISMATCH` | Credential resolves to another account. Restore the original account connection through the normal credential lifecycle. | No |
| `THREADS_RECOVERY_LOOKUP_INCOMPLETE` | Provider response or bounded history cannot establish the outcome. Keep the attempt frozen and investigate recorded coverage. | No |
| `THREADS_RECOVERY_CAPABILITY_UNAVAILABLE` | Required supported reader/status contract is not registered. Repair that capability; do not use another sender. | No |
| `THREADS_RECOVERY_CONFLICT` | Existing fact/package/lease conflicts with observation. Read canonical history and resolve through authorized review. | No |

All responses expose stage, delivery certainty, bounded next action and retry/reconciliation guidance at actual MCP serialization. Structured logs allowlist code/phase/timing/counters; no raw provider payload, text, request arguments or token. Classification must not claim a provider call happened when only a local guard failed.

### Duplicate-preflight compatibility

Do not silently weaken the current five-page complete-history guard in this package. Expose its actual coverage and actionable reason. A separately approved duplicate policy can replace all-history exhaustion with an immutable time window plus historical local facts and provider-specific completeness guarantees; until then large-history blocking remains explicit debt. This avoids claiming full hands-off Threads delivery while concealing an existing prerequisite.

## QAR-024-THREADS (proposed, not measured)

- Zero additional create/publish requests after publish_started, timeout, restart, replay, lost lease or uncertain result; provider calls measured at transport boundary.
- Container ID durable before publish; post ID durable before any readback; injected DB failure prevents next transport phase.
- Exactly one fact under concurrent matching normal completion/reconcile; zero partial writes on fault or stale commit fence; conflicts never overwrite.
- 3 rounds / 20 requests / 180 seconds cumulatively, including pages and profile/status checks; replay cannot replenish budget.
- Every changed denial has stable code, explanation, remedy and safe next action through real MCP serialization; zero synthetic secret markers in responses/logs/storage.
- Every tenant/account/revision/release/hold/attempt/generation negative case makes zero unauthorized mutation or provider call.
- Required focused, relevant regression, full build and `npm run quality:gate` pass in Tower Docker without baseline exemptions. Per-build TRUN; owner UAT remains separate.

## RISK-024-THREADS

| Risk | Required control / residual limitation |
|---|---|
| Duplicate after lost publish response | Pessimistic durable fence, no resend, separate GET-only recovery port. Missing original post ID can remain manual. |
| DB/network atomicity gap | Persist IDs immediately; no exactly-once claim. Crash after provider response before DB save remains inherently uncertain. |
| Identical manual post mistaken for original | Known ID preferred; history-only candidate is not automatic fact authority. |
| Content normalization/image/reply false match | Text-only exact comparison, validated top-level/media identity; unsupported forms blocked. |
| Forged/stale data or foreign account | Runtime schema validation, authenticated expected account, scoped record resolution and observation freshness. |
| Stale executor publishes after recovery | Same-attempt generation + serialized dispatch fence, no pre-submit resume without demonstrated quiescence. |
| Revoked approval/content mutation | Recheck before send and canonical commit; preserve observation without manufacturing a new accepted fact. |
| Secret leakage / retry storm | Allowlisted diagnostics, durable shared budget, cancellation; no raw exceptions or implicit fetch retries. |
| Broader legacy Threads routes remain unsafe/debt | Report coverage honestly; no hidden task-specific enrollment or fallback. |

## Evidence required after approval (coverage proposal, not executable scenarios)

Acceptance coverage must exercise: crash at each phase, lost POST response, saved post ID + failed permalink, successful readback + DB failure, valid direct GET recovery, wrong user/body/URL/time/media/reply, history-only ambiguous candidate, empty and incomplete/cyclic pages, revoked release/current hold, cross-tenant record, concurrent send/reconcile/late response, stale lease before commit, process cancellation and persistent budgets, unchanged legacy routes, secret injection, complete MCP serialized diagnostics. Tests use fake provider ports and real isolated PostgreSQL for races/rollback; Docker-only.

Owner UAT proposal after separate live approval: one fresh authorized ordinary text-only feed publication; read status/fact; then a controlled readback failure with retained real post ID, restore GET access and confirm the same attempt with zero extra POST. Do not use frozen historical attempts or publish synthetic public test posts without exact approval. Record provider request counts and canonical facts, not just a successful tool receipt.

## Migration, rollout and rollback

Additive table/index/FK migration with reviewed SQL, isolated restore rehearsal and verified production backup before later rollout. No rewriting prior attempts, automatic adoption or deleting historical events. New coordinator off by default; admit only generic lifecycle rows created under this contract. Rollback disables new coordinator/dispatch capability, retains recovery rows, facts and freezes; do not remove schema or reset pending attempts to retryable. Current versioned browser recovery remains independent.

## Primary provider evidence and unresolved capability gate

Inspected 2026-10-19: [Meta-owned Threads collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api) documents two-phase publishing and the optional `auto_publish_text` shortcut; this design explicitly excludes that shortcut. [Meta-owned container status request](https://www.postman.com/meta/threads/request/m47wqlq/check-container-s-publishing-status) search evidence lists status states, but direct request rendering was inconsistent. [Meta troubleshooting](https://developers.facebook.com/docs/threads/troubleshooting) returned HTTP429 to the documentation tool. Therefore supported GET container fields, polling interval and any container→post identity mapping must be verified from current official docs before that capability is implemented/admitted. No provider idempotency guarantee is assumed.

Owner decision recorded: LOCK-024-THREADS, QAR, ARCH and RISK above approved for synthetic implementation, including the explicit limit that missing-ID history candidates remain held and large-history preflight debt is not silently relaxed. No live deployment authorization is inferred from this document.
