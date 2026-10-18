# Telegraph API connector — concrete approval packet

Status: DRAFT / NOT IMPLEMENTED. Date: 2026-10-18. IDs: LOCK/QAR/ARCH/RISK-TGRAPH-001.
Owner: Innokenty Bodrov. Engineering approval does not authorize provider writes,
credential extraction, account creation, task migration or a new sender/consumer.

## Checked baseline and problem

The human commissioned an automatic Telegraph connector in message
`01a14eae-8c4e-7a11-a07e-1612b302e5d9`; this packet resolves its new API boundary,
not a request to restart the already commissioned investigation. Existing account
requested by Ops: InnokentyBodrov; possession of its API credential is unverified.

Production read-only task1140, project10: accepted/content revision1,
NO_VISUAL_NEEDED, article_cover, selected asset null, no publication fact;
channel121 analystcraft_blog is type site, adapter_kind publication_source,
account_type unknown, manual execution, api_publish false. Body length13,131.
Its schedule/publish instant is 2026-10-17T11:00:00Z. These are diagnostic example
data, never production admission constants or authority to send a past slot.
No account/secret was read from a personal browser; no live provider call occurred.

Official protocol baseline: [Telegraph API](https://telegra.ph/api), checked
2026-10-18. createPage accepts a title and a Node-array content representation
(up to64KB). Authenticated getAccountInfo/getPageList and getPage readback are
available. Page has a path, URL and optional can_edit, but no documented immutable
account ID or full publication timestamp. The API documents no idempotency key.
Consequently author display text is not identity proof; timeout is not safe retry.

## LOCK: goal and excluded authority

Implement a reusable provider adapter for explicitly bound, accepted Telegraph
articles across projects. Dry-run must expose effective provider, connection
version, exact accepted source/title/link/content hashes, visual contract, route
readiness and precise blocker. No task/account ID branches. Existing unbound site
tasks remain unchanged, not automatically promoted from handoff to API.

Initial supported payload: text, headings, lists, blockquotes, code and HTTP(S)
links; exact NO_VISUAL_NEEDED only. Unsupported embeds/HTML/media fail closed,
never disappear silently. Source-to-Node conversion is deterministic and versioned;
preview binds the accepted source plus rendered title/text/link inventory/hash.
Any semantic change requires the ordinary new content review, not connector edits.
Title must come from an explicit accepted article-title binding, not an unchecked
Planner operational label. No truncation or appended tracking/hidden markers.

Do not create/revoke an account, edit existing pages, scrape cookies, use browser
fallback, publish task1140, change dates/body/revision/old decisions, or turn on a
scheduler/queue consumer. Production credential import and first live execution
are separate operator steps under existing owner approval/release controls.

## ARCH: selected boundary and data flow

1. Add a tenant-owned ProviderConnection record with encrypted credential,
   credential version, public account metadata, owner attestation and reference
   page ownership evidence. Use the existing strict AES-256-GCM helper; missing
   key rejects storage. Do not use the legacy plaintext-fallback helper.
   The additive migration has no backfill; rollback disables admission and retains
   records/history, never drops a table or silently downgrades to plaintext.
2. Owner-only connection save/check uses an explicit field whitelist and a secret-
   free response; generic project/config endpoints must never expose this record.
   The token is entered in the protected application form, never chat, URLs,
   command line, logs, release snapshots or audit. Do not request auth_url.
3. A generic audited task-provider binding names its existing channel, accepted
   revision and connection/version. Owner preview/apply is explicit. The task's
   existing site/art-direction binding stays; global channel121 is not rewritten.
   Cross-project connection sharing is excluded from v1.
4. Use the existing tenant-owned release/WI/lease/attempt/fact primitives through
   a provider-neutral API lifecycle port; do not impersonate browser observations
   or widen the active Dzen/VK work-in-progress contracts. Before createPage,
   recheck owner release, exact manifest/content/decision/connection version and
   persist the one-send fence. No new remote runtime, worker or consumer.
5. Fixed HTTPS api.telegra.ph POST transport; token only in form body, redirects
   forbidden, no URL fetch from article content, bounded parsing and schema.
   Persist a bounded secret-free receipt before canonical confirmation. A receipt
   is not success: require exact Node/title/links, valid path/URL and authenticated
   page-list membership/readback. Same-connection locks serialize API writes.
6. Existing delivered/history and exact replay are read-only. Uncertain/started
   work is reconciliation-only; never reset attempt/key or call createPage again.
   Read-only reconciliation scans a bounded authenticated inventory and full
   candidate content; incomplete or multiple matches remain UNKNOWN. Absence in a
   bounded search is not proof of no publication. Preserve original receipts.

Alternatives rejected: browser automation (unnecessary credential/session surface),
new account per publication (wrong identity), timeout retry (duplicate public
articles), provider literal changes in Dzen/VK WIP (ownership/custody confusion).

## QAR: measurable first-slice budgets

- Synthetic concurrent release/start load:20 callers; at most1 createPage transport
  invocation and1 canonical fact per exact accepted package/attempt.
- Non-mutating dry-run:0 provider writes,0 credential changes,0 WI/attempt changes.
- HTTP deadline20s total, no mutation retry; response cap256KiB; deterministic
  Node UTF-8 content cap64KiB, depth32 and4,096 nodes; boundary tests at each cap.
- Reconciliation: at most10 list requests of100 entries plus20 candidate reads,
  total deadline30s, at most1 read/sec/connection; partial budget exhaustion UNKNOWN.
- Local manifest/identity/version/hold drift and malformed/redirect/secret-bearing
  responses reject before fact creation. Raw credentials/auth URLs never appear
  in application logs, MCP/REST DTOs, telemetry, fixtures or operator evidence.
- Simulate response loss after create, server restart, DB/audit failure, concurrent
  confirms, wrong tenant/account/source/link/receipt and ambiguous old duplicate.
  Relevant quality/build suites and independent exact-head review must pass.
- All test/build workloads run in bounded tower Docker with synthetic DB/provider;
  no restored/production DB mounts, real credentials or public test articles.

## RISK: explicit residual decisions

The API does not give an immutable account ID: connection continuity plus an
owner-attested existing account/reference-page proof is weaker than provider-
signed identity. Token rotation invalidates pending release bindings until an
audited rebind; never accept equal author_name as account equivalence.

Provider creation time is unavailable. Proposed v1 evidence must distinguish
server-observed creation acknowledgment/confirmation time from provider time and
must not backdate to the planned slot or infer a year from the path. Before any
canonical fact implementation, audit downstream fact/time contracts. If they
require a provider-sourced timestamp, keep confirmation BLOCKED_TIME_PROVENANCE
rather than fabricate one; a compatibility change needs a separate reviewed delta.

Once-only prevention can leave a real article in UNKNOWN after response loss.
This is an accepted availability tradeoff only if the owner approves it; manual
evidence/reconciliation may be required, never an automatic replacement page.
No zero-duplicate/exactly-once guarantee is claimed for the external provider.

## Requested decision and next gate

Approve LOCK/QAR/ARCH/RISK-TGRAPH-001 for implementation and isolated verification,
including the additive encrypted connection store, explicit task-provider binding,
bounded reconciliation and the residual identity/UNKNOWN constraints above.
This approval is not credential import, production migration/deploy or publication
authority. After approval, derive final executable scenarios, prove causal RED,
implement the shared port and connector, obtain independent exact-head review,
then present release/UAT evidence. No final RED or production code is authorized
by this draft packet itself.
