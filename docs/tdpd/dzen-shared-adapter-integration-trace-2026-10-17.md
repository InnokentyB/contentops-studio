# Dzen shared adapter integration — source trace and proposed delta

Status: review preparation, not an approved specification lock or live authority.
Inspected baseline: `0f457ea`; canonical main rechecked at `190621a` on 17 October
2026. The Dzen files traced below are unchanged between these revisions. Main now
includes Setka alongside LinkedIn and DEV.to in the shared browser contract.
PR172 changes only the two browser launch options; it does not implement this delta.

## Actual owning path

| Boundary | Existing implementation | Remaining shared mechanism |
| --- | --- | --- |
| Authenticated command | `src/mcp/tools/tomorrow_publication_tools.ts` registers exact preflight/publish/reconcile tools; `src/mcp/capabilities.ts` exposes their names | Reusable documented command inputs with principal-bound project/actor and validated task identity; no new tools per publication |
| Preflight | `src/services/dzen_task1002_route.service.ts` checks manifest then `requireDzen1002Action('inventory')` before connector work | Resolve current tenant-owned task/channel/account and approved package as data; preserve complete published AND draft inventory and unknown-pagination rejection |
| Publish entry | `src/services/dzen_task_publication.service.ts`, `execute`, validates owner/manifest and action scope before entering the runtime | A shared provider entry must replace fixed package dispatch rather than extend this oversized task table |
| Lifecycle | `src/services/dzen1002_runtime.ts` claims once, starts before mutation, rechecks before submit, saves receipt before confirmation; reconciliation only loads the original attempt | Reusable immutable package and attempt contracts; no task/account/revision literals in new runtime code |
| Persistence | `src/services/dzen1002_runtime_store.ts` and `_store_guard.ts` use Serializable transactions, CAS, DeliveryAttempt and WorkflowEvent; receipt custody survives subsequent owner/manifest drift | Parameterize validated tenant/package scope while retaining all claim, audit, identity and receipt fences and recognizing existing attempts |
| Server wiring | `src/services/dzen1002_runtime_production.ts` constructs server-owned DB/fact/manifest/native ports | Reusable provider adapter resolution inside the selected server, with verifiable registration and capability identity; no caller-supplied transport/session |
| Native access | `src/services/puppeteer/dzen1002_publisher.ts` resolves/decrypts channel config inside Planner; both account and lookup are fixed. Inventory launcher is `src/services/dzen1002_inventory_browser.ts` | Protocol-specific Dzen endpoints/selectors may remain provider code; account, tenant, package hashes and task identity must come from checked data |
| Fact boundary | `src/services/publication_manual_fact_guard.ts` blocks manual confirmation of the exact task; runtime store owns receipt-to-fact transition | A lifecycle-owned generic fence must prevent manual/MCP/REST bypass for every admitted package, without dropping existing exact protections during migration |
| Fallback | `src/services/publishers/publication_dispatcher.ts`, `routeToBrowserPublication`, returns the Dzen adapter requirement before generic browser writes | Preserve this block. Adapter unavailable must never select a Codex browser, direct API, worker or another chat |

The traced Dzen production graph does not call a runtime registration/capability
resolver for the native transport. The string
`planner_registered_independent_adapter` in the route contract is an identity
requirement, not proof of a registered, healthy, authorized adapter. No live
registry/session inspection was attempted; do not infer production readiness
from this static finding.

The common `browser_publication_contract.ts` lifecycle currently requires manual
execution mode/manual-handoff capability and accepts caller observations. Merely
adding Dzen to its provider enum would not meet the mandatory independent,
Planner-owned adapter route. Do not implement that as a shortcut.

## Proposed implementation boundary

Retain the owner-selected existing server and existing persistence tables. A
shared provider lifecycle should accept only validated IDs, expected revision,
manifest and approval binding, then load current tenant-owned records. Body,
asset identity, schedule, Registry/account identity and capabilities are resolved
and checked at that boundary, never trusted from a caller-provided permission,
transport, cookie or observation. No new worker, clearance service, credential,
publication instance or task-specific production endpoint is proposed.

Construct the immutable claim from those records. Keep one fresh committed claim
and one consumed start fence; revalidate immediately before final submit. Network
allowlists remain phase-scoped and protocol-specific, but use the resolved
account/object identity. Keep exact body/asset validation, retained final control,
request/time/byte limits, sandbox defaults and explicit resource cleanup.

Store native evidence in a strict bounded receipt tied to the immutable original
claim before attempting fact completion. Authenticated reconciliation revalidates
its actor/tenant boundary and original attempt; it cannot claim or resend.
Receipt custody must survive post-submit changes in owner/manifest/package
eligibility. UNKNOWN, started, expired and uncertain never reopen dispatch.

Preserve existing release/attempt/job/event/fact history and namespaces. Before
cutover, enumerate how both old and shared attempts are recognized; any ambiguous
old started record stays frozen. Do not copy old exact dispatch tables into new
code, reset old claims or migrate production rows as part of a refactor. If an
existing schema cannot express the required unique fence, stop that change for
explicit compatibility/rollback review instead of silently weakening it.

## Verification still needed for that delta

1. Shared acceptance fixtures exercise two different valid packages and a foreign
   tenant, changed account/revision/manifest/asset, role revocation and manual fact
   bypass. A new ordinary package must work as data without a new code branch.
2. Real isolated PostgreSQL tests exercise competing keys/processes, start/submit
   drift, rollback, receipt persistence before fact, immutable custody and
   same-attempt reconciliation, including recognition of legacy uncertain rows.
3. Adapter integration uses the actual registered server-owned port in a
   non-root Tower container. Synthetic local browser content verifies sandbox,
   allowlisting, native extraction and failure cleanup with no social cookies or
   provider access. Shared infrastructure smoke results alone are insufficient.
4. Reuse reviewed Docker/Compose infrastructure; document the scoped integration
   job, health/exit result, limits, logs and stop command. The existing Dzen DB
   fixture runner is host-oriented; its project logic must be moved into a
   temporary container before use on Tower. Restored migration data is excluded.
5. Run required quality/build/regressions against the exact revision, resolve
   review findings and obtain explicit owner UAT. Offline doubles and compilation
   do not establish a permitted native session or publication success.

This is preparation for the shared delta, not another approval prerequisite for
PR172's two-line security correction. Existing approved runtime tests remain
evidence for the exact route, not complete acceptance coverage of this proposed
shared adapter.

## Independent policy boundary

`src/services/dzen1002_action_restriction.ts` records the actual task1045 refusal
and throws before native work because task1002 applicability is unresolved.
Preserve the original outcome restriction across the shared route. No owner
release, Registry proof, adapter registration, fixture or hardcoded permitted
flag resolves it. Authoritative provider-policy applicability remains required;
do not probe the provider to test around the refusal. Until resolved, code and
offline integration can progress while live inventory/publish/readback stay held.
