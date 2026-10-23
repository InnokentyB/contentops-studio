# Shared dispatch and truthful readiness — bounded implementation packet

Status: APPROVED for local tests and implementation by direct Owner answer «Утверждаю локальную реализацию» to call_54063f1ac2234c32b30afddc354f0ee3 on2026-10-23. Public code/deploy/live admission remain excluded. Current engineer: Codex root. Baseline PR201 merge557365154e415816730bfe744591878c7231941b, tree2b333a61cac5e69fcd4dd4fc8e91af5e9a4ae0bc. Implementation must branch/rebase from that exact current source, not this audit branch's older44a2457 code.

## LOCK

Fix two verified shared-boundary defects without adding send authority: (1) the generic publication dispatcher selects a legacy Threads task allowlist although a shared revision-bound release/sender exists; (2) read-only browser diagnosis projects an active, error-free, pre-permit attempt as UNKNOWN merely because an attempt exists.

The existing authenticated MCP publication command remains the operator boundary. A fresh generic Threads API execution must resolve an exact current audited release through the existing common sender and capability contract, never a task-ID table. The dedicated generic Threads command remains compatible and must share the same admission decision. Missing generic release inputs produce a precise unsupported/incomplete-envelope diagnostic, not an invented tenant mismatch or a silent fallback. Existing historical attempt/fact/legacy histories must remain reconcilable by their supported historical route; this packet does not reopen or resend them.

Readiness must distinguish supported route, credentials, canonical package, release and actual send admission. Do not expose route_executable:true as readiness to send while live admission is unsupported. Dry-run and live must agree on the selected route and every locally verifiable predicate. A diagnostic never grants Submit or activates API transport. The current browser-primary instruction and existing separately authorized API sends remain unchanged.

Browser diagnosis separates current active error-free preparation before any recorded permit from persisted uncertainty and expired/missing executor control. It must not claim NOT_DISPATCHED based only on absent permits. It reports no permission itself. An expired lease yields a specific recovery/fencing correction, not a suggestion to start again. Any observed permit, dispatch, error, ambiguous history or existing recovery state remains governed by its existing no-resend controls.

No task-specific code, new sender, provider calls in diagnostics, profile migration, changed approvals/schedule, attempt reset, production repair or activation. X native signed receipt gates remain mandatory. Real reader/supervisor admission and historical-attempt adoption are separate readiness work, not fabricated by this patch.

## QAR

Zero provider calls/claims/attempts/permits/facts/audit writes for dry-run/read-only diagnosis. Exact-project, authenticated actor, accepted revision/body/asset/identity/manifest, immutable release and idempotency bindings must stay enforced by the existing generic service. Every independently known failure returns stable safe codes, fields, supported correction and retry_allowed:false; no original payload/credentials in output/logs.

Required container evidence before handoff: RED then GREEN at registered MCP boundaries for shared routing and diagnostics; unchanged supported dedicated generic sender; missing/stale/foreign/forged release; historical attempt/UNKNOWN/fact handling; future slots; active versus expired lease; pre-permit versus issued permit and persisted recovery; no provider call or record mutation from preview; redaction. Required build, quality gate with baseline unchanged and relevant existing regression suites. No actual scenarios/tests before Owner approval. Owner UAT remains distinct.

## ARCH

Introduce small shared routing/admission helpers outside the oversized MCP module. Resolve actor from current authenticated principal, require matching current project membership and preserve all service-level checks. Extend the common request schema only with the explicit generic release-binding fields actually required; strict validation rejects incomplete/contradictory envelopes. Reuse GenericThreadsReleaseService.publish and its exact audited release verification, bounded preflight, durable claim, fact readback and uncertainty handling. Do not call raw Threads publish APIs from a new path.

Explicitly classify historical custody by stored audited lifecycle data; retain necessary old reconciliation readers without promoting literal historical business IDs into new execution authority. Enumerate every importer/command that still reaches the old sender before declaring the allowlist removed as working architecture. No silent new transport selection from Registry availability alone.

For diagnosis, inspect scoped current attempt, work/lease, permit/audit and persisted recovery with bounded reads in a consistent read-only snapshot. The response states evidence limits and the corresponding supported next action. No boolean returned by the diagnostic may become a trusted execution capability. Missing or multiple/conflicting attempts and incomplete custody remain unknown-safe.

Use existing schema where possible; no migration expected. If implementation proves a new canonical schema or substantive transport/admission change necessary, stop for an amended concrete design instead of expanding this packet. Additions are generic protocols, never business-ID allowlists.

## RISK

Main threats: duplicate publication via legacy/generic path split; forged actor/release inputs; dry-run claiming unsupported send readiness; false NOT_DISPATCHED from incomplete logs; expiry between diagnosis and pre-submit; another actor/tenant or revision inheriting approval; secret disclosure in error details. The existing canonical transaction, audit, CAS, single attempt, exact binding and native receipt gates remain final authority after any read-only preview.

An issued/lost permit remains uncertainty even if no post is visible. Missing historical writer coverage cannot be treated as evidence of absence. No general Owner absence claim, ad-hoc SQL, another sender or browser/API switch substitutes for supported reconciliation/fencing. The actual Owner's existing explicit additional-send workflow is preserved separately; this packet neither invokes nor broadens it.

Rollback restores only code, retaining all historical facts, attempts, leases and audit. No bulk data transitions. Public push/PR/deploy and live enablement are outside this local packet; prepare exact tested code for separate release review. Operations on1158/1160 continue independently through already supported routes and existing permissions.
