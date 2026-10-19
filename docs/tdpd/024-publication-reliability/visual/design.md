# REL-05 — reassess a visual requirement without editing accepted copy

Status: LOCK/QAR/ARCH/RISK approved by owner on 2026-10-19 for synthetic implementation. Baseline deployed main3fd625a. Original design below is retained; current implementation and actual MCP/PostgreSQL verification are in package notes and combined TRUN. Production remains unchanged.

## LOCK / surface

An authenticated Owner can request a new meaningful visual assessment for an unchanged accepted unpublished revision whose current decision is NO_VISUAL_NEEDED and whose art-direction WI is completed. New instruction must not require a fake text edit or duplicate task. This initial slice is deliberately bounded to selected_asset_id=null, no active executor, no existing release authority requiring cancellation, no delivery attempt/fact/published link, and no active related visual work.

Proposed generic MCP tool `ba_request_publication_visual_reassessment` with preview/apply. Inputs: validated tenant/task, expected content+accepted revision/body digest/channel/placement/schedule, expected current decision ID/version and completed art WI, bounded new requirement/reason and owner-instruction reference, idempotency key. Authenticated principal supplies identity and Owner authority; external instruction reference is attributed evidence, not verified by an LLM assertion. No business-ID literals or incident-specific tool.

Preview returns blockers and exact proposed state transition with zero writes. Apply creates one new available Art Director WI and immutable request audit, sets visual_mode=required, visual_state=PENDING_ASSESSMENT and handoff_state=blocked, and removes derived execution readiness through the canonical lifecycle. Text, revision, acceptance, channel, schedule, existing decisions/WIs/assets/events/attempts remain preserved. Old completed WI is never reset/reused. Current old decision remains historical context until a new version supersedes it normally.

Art Director receives the new requirement and must explain the visual function/contribution using the existing meaningful-visual brief contract. Required mode rejects NO_VISUAL_NEEDED. Generation/source, provenance and independent asset review remain ordinary pipeline steps; owner request neither generates/approves an image nor permits publication. A protocol-forbidden placement returns a specific conflict instead of changing channel/placement.

## Evidence and known hazards

- `src/services/work_queue/recovery_operations.ts:160–225` implements Owner `requirePublicationVisual` for first input only; existing decision/WI returns VISUAL_REQUIREMENT_ALREADY_MATERIALIZED. File996lines: add a small module/facade instead of extending it.
- `src/services/art_direction.service.ts:146–187` accepts revision and upserts the same WI dedupe key with empty update; backfill is not reopen.
- `submitDecision` requires claimed lease/revision and supersedes active decision; it currently lacks explicit reassessment-generation binding. `getContext` must expose the new instruction from server-owned request data.
- `calculateVisualReadiness` currently returns ready when pipeline disabled, and for NO_VISUAL_NEEDED before checking required mode. Explicit new owner requirement must not disappear through these early exits. Preserve unrelated legacy behavior; fix the new request's canonical guards, not mass-reclassify all historical tasks.
- `browser_publication_contract.ts` checks current visual state, decision version and NO_VISUAL_NEEDED admission; release/claim/start/pre-submit/fact boundaries must retain these checks. `browser_publication_guard.ts` verifies exact release/work/audit bindings.
- Image attachment/review callbacks and direct publishers are additional writers/projections. Audit them before final tests; task status alone is not sufficient fencing.

## ARCH

New typed reassessment service + request schema + thin Owner registration. Reuse ContentItem/ArtDirectionDecision/WorkItem/WorkflowEvent as canonical lifecycle; use a versioned server-owned request projection bound to the new WI and audit rather than a second publication fact store. New WI uses accepted revision as input_context_version and a distinct dedupe key tied to exact prior decision/WI and request generation. Hash the entire normalized request for idempotency; changed replay rejects.

Serializable transaction and exact content-row CAS/lock recheck current accepted package, active decision, completed prior input, absence of facts/attempts/current release authority and related consumers. Publication writers must serialize on compatible locks and revalidate visual requirement/state at their commit/permit boundaries. A new request cannot race a stale release/claim into a live permit. If compatible fencing requires changes beyond the shared canonical lifecycle, surface a design delta before implementation.

No automatic cancellation/invalidation of already released/claimed/started jobs in this slice. Those cases return an actionable blocker; known or uncertain dispatch remains reconciliation-only. This preserves history and avoids claiming a DB token rotation recalls a physical submit.

Pending reassessment must block readiness, release, dispatch, old asset review and late callbacks even while the old decision is retained. Project pipeline disable must not silently revoke this explicit requirement. Implement a typed server-owned active request binding and consult it at all affected canonical boundaries; do not trust arbitrary client JSON. Fulfilment occurs only through the new decision and reviewed current asset. If a new durable field/model is necessary to make this enforceable, its additive schema and migration are an approval delta, not an inferred exception.

Canonical completion must atomically check the active request generation, its new WI ID, current authenticated Art Director lease and frozen revision/package before superseding the prior active decision. An old WI callback cannot complete the reassessment merely because its revision still matches. Completing art assessment alone does not close the visual requirement or unblock publication: bind the new decision, then close/fulfil the request only atomically with approved current asset/readiness (or an explicit supported terminal block). Independent review/source/generation completion must carry the same request/decision generation. All replay and late-callback paths recheck this binding.

## QAR

- One WI + one request event for replay/concurrency; altered packet, wrong tenant/Owner or stale binding causes zero writes/provider calls.
- Exact old text/revisions/date/channel/history retained. Zero new attempt/permit/fact and zero provider sends during preview/apply.
- All affected release/start/permit/readiness/callback paths reject the stale no-visual package after the reassessment commits; no legacy early-return bypass.
- New Owner requirement is visible in actual Art Director context; required-mode NO_VISUAL_NEEDED rejects with cause and correction.
- Transaction failure rolls back request/WI/content/audit together. No copy, token, signed URL, cookie or raw provider payload in errors/logs.
- Actual MCP identity and isolated PostgreSQL race/rollback acceptance, affected generic art/browser/direct-publish regressions, quality gate and builds in bounded Tower Docker.

## RISK / proposed acceptance coverage

Risk is public duplicate/wrong-content dispatch and stale visual authority. Proposed post-approval coverage: preview no-write; successful unchanged-copy request; exact replay/changed replay/concurrent requests; role/tenant spoof; concurrent release/start; active/no-longer-active leases; issued permit/UNKNOWN/fact; changed revision/decision/channel/date; disabled pipeline; late old asset callback; new decision/asset review; transactional rollback and secret markers. Test all canonical writers/projections discovered by audit before claiming GREEN. Final scenario definitions and RED implementation follow approval.

Owner UAT: inspect unchanged accepted copy/history, see the new meaningful-visual instruction in Art Director, follow ordinary asset review, and verify ordinary publication remains blocked until completion. No real image generation or publication is implied by synthetic UAT.

Rollback blocks new reassessment requests but retains request history and readiness/dispatch guards for already created requests. Do not delete the request, reset completed WI, restore stale no-visual readiness or grant old release authority.

## Authority

Specific design approval authorizes synthetic implementation/testing only. No production data repair, provider call, policy change, public push/PR or deploy is included. Live admission and owner UAT remain explicit. This is a reusable lifecycle correction, not an exact incident repair.
