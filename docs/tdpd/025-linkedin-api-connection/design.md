# LinkedIn connection and governed API delivery

Status: OWNER APPROVED LOCK/QAR/ARCH/RISK for local tests and implementation, 2026-10-19; native answer to call_32218e78462f464ba9ddfe1f74147f6f: «Утверждаю дизайн и передачу в Portfolio HQ». Public code export, migration/deploy, credentials provisioning and provider sends are separate readiness/authority boundaries. Prepared from production006025beb358299a6f91422d7e0f0d49d23c6a3e and local6f73f8737a1b7bfa45297eacfa4c8480359754d2. This document is not a publication permit.

## Evidence and business boundary

Direct owner request verified in Portfolio HQ userMessage01a15557-2714-76a3-bcea-e84919d5d6ea: prepare callbacks/code and publication through the existing LinkedIn API, parallel work allowed. Existing exact revision, asset, tenant, owner release, attempts/facts/audit and uncertainty controls remain mandatory. The exact local LOCK/QAR/ARCH/RISK approval is recorded above.

Read-only Railway inspection of planner-app and planner-mcp: LINKEDIN_CLIENT_ID is absent/invalid, LINKEDIN_CLIENT_SECRET not configured, API_URL not configured; current code therefore computes http://localhost:3003/api/auth/linkedin/callback. FRONTEND_URL on web is https://publishplanner-production.up.railway.app. Public HTTPS callback route https://publishplanner-production.up.railway.app/api/auth/linkedin/callback was independently requested without code/state and returned400 at the expected missing-parameter boundary, with no exchange or persistence. That HTTPS URL is the proposed production redirect URI; it is not the currently computed runtime URI.

Portfolio HQ observed Developer UI: proposed application230740081, public clientID78vyajh4lq0ftc, Community Management API Development Tier, no configured redirect URI, no OpenID product. These UI facts are delegated evidence, not an independently queried runtime binding. The second application230753072/client78x4krqhmgq7ox is not proposed for this connection. App-level available permissions do not establish issued token permissions, exact member identity, organization authorization or personal read access.

No provider calls, token reads, sender activation, route mutation, callback registration or production configuration changes occurred in this audit. Credentials must be configured through an approved private mechanism; never paste secrets/codes/tokens into chat or documents.

Additional read-only server-side projection of the two owner-requested tenant channels: neither has a plaintext or encrypted access_token, recorded linkedin_urn, expiry metadata or scope metadata in the fields consumed by the current integration. Only Booleans and a validated public identity field were selected; credential values were not selected. Thus no stored usable connection in this integration is established, and issued provider grants/identity/organization authorization remain unverified. This does not assert that no external LinkedIn tokens exist elsewhere.

Goal: an Owner reconnects an explicit LinkedIn channel, sees a precise reason and remedy for missing permissions/identity/expiry, and releases an ordinary accepted task through one supported API lifecycle with exact media and verified fact. No business-specific runtime functions or branches. Initial shape: public original feed text, optionally one accepted image. Other shapes reject before provider writes.

## LOCK-025A — Owner OAuth connection

Primary surface: existing Settings/LinkedIn connection flow and existing connect/callback HTTP routes. Owner selects an existing LinkedIn channel explicitly; reconnect must not infer a target or create an accidental personal channel. General new-channel creation is outside this first slice. Initiation requires authenticated non-demo Owner and tenant-owned channel; organization and personal account kinds remain distinct.

New additive provider OAuth connection-attempt ledger binds a random256-bit opaque state hash to provider/purpose, initiating Owner/project/channel, expected account identity, current channel configuration generation/hash, fixed redirect URI, browser binding, creation/10-minute expiry, consumed status and safe audit. State contains no private project/user data. Browser binding uses a per-attempt Secure/HttpOnly/SameSite=Lax cookie; missing/mismatched binding requires restart, never a bearer token in redirect query.

Callback validates state, browser, TTL, current Owner/channel and fixed redirect before handling either code or provider denial. Atomic pending→exchanging CAS consumes the one-use attempt BEFORE network exchange. Concurrent/replayed/expired callbacks cannot exchange again. No network inside DB transaction; crash or unknown exchange leaves the attempt consumed with reconnect guidance, never an automatic code retry. Recheck membership, identity and channel generation immediately before atomic credential+audit+completed commit. Audit failure rolls back credential changes. Clear cookie; no-store/referrer protection; no arbitrary return URL or raw provider error logging.

Use supported app permissions and Profile API identity via r_basicprofile when actually available, rather than assuming OpenID. Organization reconnect preserves the exact organization URN and verifies action-specific organization authority through a permitted supported read endpoint. Wrong member/organization/role never silently overwrites or creates another channel. Capture validated actual expiry/client binding/granted scopes, using supported introspection when necessary; absent evidence remains UNKNOWN. Analytics availability is derived, never unconditionally true.

New credentials require existing authenticated encryption machinery with fail-closed key availability. Extend all LinkedIn credential readers and secret projections together. Never allow an encryption failure to store plaintext; preserve unrelated config. Existing legacy plaintext tokens may only be read under existing compatibility behavior until an explicit reconnect; do not bulk rewrite credentials or claim them verified.

## LOCK-025B — reliable generic API route

Use existing canonical content item, accepted revision, selected asset, owner release, deliveryAttempt and publicationFact. No separate parallel publication authority, synthetic admission prerequisite or task-specific endpoint. Add a provider-specific implementation of generic API execution/recovery state: current ApiDeliveryRecovery shape may be extended only with explicit transport/version parsing and tenant/attempt uniqueness; never feed LinkedIn snapshots through Threads parsers. Record exact schema delta before RED.

Read-only readiness distinguishes configuration, token validity/actual grants, verified member, organization authorization, post-read capability, image-read capability and route/lifecycle readiness. Do not prove readiness by uploading or creating a post. Personal write permission alone is insufficient for automatic send-and-verify; missing supported read access blocks with precise app/reconnect guidance. Keep route/admission default off until real bounded smoke and explicit route release.

Release and execution bind exact accepted text/hash, art generation/decision/review, selected asset/hash, account author, channel, current approval, allowed operation and transport. Any unresolved historical attempt, existing fact, competing work/release/hold blocks another API attempt. Recheck all bindings at the last side-effect boundary and canonical commit.

Resolve accepted media only through tenant asset storage; verify actual bytes/type/size/dimensions/SHA. Use supported Images initialize/upload/readiness and Posts REST APIs with a permitted pinned version and Rest.li headers. Persist image identity and phase before proceeding; bounded readiness requires AVAILABLE/correct owner. Never downgrade an accepted image to text or fetch an arbitrary caller-supplied URL/file. Upload URLs and provider payloads never enter logs/audit/public responses. Input byte hash is our verified input evidence, not an invented provider-returned hash.

Before the public Posts POST, durable CAS marks dispatch_started after current authority checks. At most one public POST per attempt. Persist trusted returned postID with immutable attempt/package correlation. Timeout, loss of result, missing ID or persistence failure means UNKNOWN; no browser fallback, automatic new attempt or resend. Media preparation may be held until same-generation continuation is proven safe; no undocumented provider idempotency assumption.

Only GET of the proven same-attempt object can reconcile. Verify author, body semantics, public original-feed lifecycle, publication window and exact recorded image identity, with current package/release/tenant/hold checks. Atomically commit canonical fact, successful attempt and completed API state. Receipt alone is not verified publication. Recovery maximum3 rounds/20 requests/180 seconds across process recreation; cancellation/revocation/lease expiry prevents late fact commit. No history similarity adoption and no inferred negative proof.

Close all legacy dispatch/legacy publisher entry points and fallback paths for API-lifecycle-owned tasks; mode flags/token presence never create publication authority. Preserve unrelated adapters. Existing unresolved browser attempts remain reconciliation-only: no reset, conversion, adoption, duplicated task or route switch to evade uncertainty. Historical attempt44 is an immutable operational constraint, not a new production literal. It remains held until real supported technical reconciliation/fencing evidence exists; this release does not invent that proof.

## QAR and failure contract

- Every error response gives a static safe cause and next action; no token, cookie, authorization header, auth code, secret-bearing provider body or SQL is logged/persisted in evidence.
- OAuth attempts expire10min; exactly one callback can consume one attempt; foreign tenant/owner/demo/revoked/stale/channel-swapped cases cause no provider exchange or token overwrite.
- Provider bodies and calls are bounded; phase timeouts, size limits and approved destination validation are explicit per adapter. No redirects for credential-bearing requests.
- Publication/recovery budgets remain durable across processes. At most one public send; every ambiguous send is held, never a retry recommendation.
- PostgreSQL concurrency/rollback tests cover callback CAS and canonical delivery/fact/audit atomicity. Exact media failure yields no text-only public post.
- Mandatory focused real HTTP/MCP boundaries, isolated PostgreSQL integration, npm quality:gate and backend/frontend build run in Docker. No native project workloads.
- Real grants and provider identity require a bounded production read-only smoke before discovery/admission; deterministic tests do not constitute live readiness or owner UAT.

## Architecture, risk and release order

Components: typed OAuth contract/service/repository; thin existing route handlers; existing Settings selection/status; shared encrypted channel credential resolver; typed Posts/Images adapter; generic API release/send/readback lifecycle using canonical attempts/facts; closed legacy route boundaries. Split modules; no new any/silent catches/oversized modules or scanner exemptions.

Main threats: login CSRF/state replay; channel or organization swap; owner revocation; credential leakage/plaintext fallback; requested-vs-issued scope confusion; upload destination abuse; stale text/visual/asset; image downgrade; duplicate public POST after timeout/crash; legacy fallback bypass; unsafe takeover of browser uncertainty. Each requires a named boundary test after approved LOCK, including concurrency and injected audit/persistence failures.

Release sequence: approve this concrete LOCK/QAR/ARCH/RISK → finalize scenario/test matrix → prove intended RED in Docker → minimal implementation/GREEN → code/security review and required quality/build → exact public export approval if required → CI → fresh backup+restore/schema compatibility → additive migration and controlled deploy with admission off → private credential/callback provisioning and human OAuth consent → actual read-only token/identity/organization/media/post-read readiness → explicit route/package release and owner UAT. No early flag flips or provider POST probes.

Rollback keeps all OAuth/delivery/fact/audit rows and uncertain holds; disable new admission and revert compatible application code. No migration reset, table drop, token dump, database restore over newer facts or attempt deletion. OAuth credentials need a separate private configuration step; no secrets are present in this artifact.

## Sources

- https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-authorizations/getting-started?view=li-lms-2026-09

Local implementation and synthetic verification are complete; see integration/README.md. No production migration, live OAuth exchange, provider publication or Owner acceptance is claimed.
