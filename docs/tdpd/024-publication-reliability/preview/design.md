# REL-03 — read-only publication preflight

Status: LOCK/QAR/ARCH/RISK approved by owner on 2026-10-19 for synthetic implementation. Original design below is retained; actual SDK/PostgreSQL implementation and verification are in package notes and combined TRUN. No provider calls or production activation.

## Problem and LOCK

Operator must inspect an accepted publication's blockers without invoking a tool classified as an external write. Current `ba_publish_publication_task` and `ba_publish_threads_task` combine dryRun/live with static EXTERNAL_PUBLICATION_ANNOTATIONS. Annotations are not the proven complete cause of any specific Codex rejection. A new read-only tool cannot grant live-send permission or override a host policy.

Proposed interface: `ba_preview_publication_task` in the existing MCP surface, initially available only to authenticated Owner/Publisher profiles with normal tenant/task-read authority. Inputs are validated project/task references and optional expected accepted revision/package digest. Do not accept actorId to override authenticated identity, transport credentials, arbitrary URLs or a bypass switch. Existing tools/permissions remain unchanged.

Output: checked time, task/provider/route identity, accepted revision/package digest, local validation state, known publication/attempt state, structured blockers with cause/action/role, and a separate `providerReadiness=NOT_CHECKED` unless existing governed evidence is available. It is a snapshot, not release/permit/send authority. No raw provider/config payload, credentials, signed asset URL or approval binding is exposed. Reuse existing protected task reader for accepted copy; this tool need not duplicate full content.

Functional rules: validate accepted content and visual bindings, terminal/published/started/UNKNOWN state, configured route and required local metadata. A missing release remains a blocker with a supported action, not an attempted repair. An unsupported route is explicit, never a silent Telegram fallback. No new business-ID dispatch branches. Provider type constants are valid; task/account/project IDs are input data.

## Source evidence

- `src/mcp/tools/task_publication_tools.ts:41` routes the legacy command via exact Dzen IDs, Threads detection then Telegram. Do not reuse this dispatcher as a generic read-only preflight.
- Same file:272–302 registers both preview/live commands with external-publication annotations.
- `src/services/threads_task_publication.service.ts` contains generic and historical paths; some dry-run paths inspect provider state. `threads_generic_release.service.ts` must be inspected for helper side effects before reuse.
- `src/services/telegram_task_publication.service.ts` mixes payload construction and publication. `src/services/publishers/publication_dispatcher.ts` contains mutation paths; do not import the sender to obtain a preview.
- `src/mcp/capabilities.ts` and `src/tests/remote_mcp_auth.test.ts` govern role discovery/identity and assert existing live annotations. Preserve those live controls.

## ARCH

Add a small typed preflight contract, a DB read model and pure provider-local validators, plus a thin MCP registration. Existing authoritative validators may be shared only after demonstrating they are pure/read-only and preserve successful behavior. No materially extending existing oversized services: `work_queue/recovery_operations.ts`996lines and other large modules are not a destination for this feature.

Read a consistent task/channel/assets/active decisions/fact/attempt/release snapshot in a read-only transaction. Enforce authenticated project access before reading task data. Enforce field allowlists in Prisma/SQL SELECT itself: loading all Channel.config then filtering it is not allowed. Validation consumes an allowlisted non-secret projection; credential existence may be represented only by separate safe managed-allocation metadata, never by loading secret-bearing JSON, decrypting or returning raw secrets. If safe metadata is unavailable, return NOT_CHECKED. Side-effecting normalization/materialization/claim/release/repair is forbidden.

Annotations: readOnlyHint=true, destructiveHint=false, idempotentHint=true, openWorldHint=false for this local-only operation. No provider network requests, session/login checks, credential refresh, asset fetch or external storage writes. These annotations describe tested behavior; they do not promise approval-free operation in every Codex client.

Dzen/VK: obey `docs/operations/vk-owned-publication-route.md`. New preflight never probes sessions/API/browser. Local metadata can identify the governed route, but must report route readiness NOT_CHECKED/BLOCKED unless a permitted registered independent-adapter contract already persisted scope/version/freshness-bound evidence. This command may read that retained evidence only; invoking an adapter reader or network operation is forbidden. It must not replace the governed contract with DB inference or another chat. No external reader is added by this package.

## QAR

- Zero DB/audit/work/attempt/lease/permit mutations; zero sender/provider/storage/credential-refresh calls on every success, denial and malformed request.
- Cross-tenant/spoofed identity reads expose zero task/package data through the actual MCP serialization boundary.
- Bounded snapshot: no unbounded event scan; limit queried collections explicitly (latest relevant decision/fact and aggregate active-attempt/work states). DB transaction timeout5seconds; local operation target within5seconds excluding unavailable DB, which returns actionable dependency error.
- All blockers have stable code, observed cause, next supported action and role. Unobserved provider/account access remains NOT_CHECKED.
- Existing live annotations/role gates and successful publisher contracts remain unchanged; no weakening to make preview pass.
- Focused boundary tests, affected role/auth/readiness regressions, quality77/7096 no-regression and relevant builds in Docker.

## RISK and proposed coverage

High-integrity boundary: stale preview must not bypass current dispatch revalidation. Preview intentionally cannot certify absence of publication, successful provider authentication or no concurrent executor. UNKNOWN/started always yields reconciliation guidance, never retry/new key. A read-only caller may still be denied by the host; report that layer honestly.

Proposed acceptance coverage for after gate: actual MCP discovery/serialization and static annotations; injected fail-on-write/network/secret adapters; accepted text-only/image tasks; unsupported route; stale expected revision; lease/permit/UNKNOWN; cross-tenant/role spoof; same snapshot concurrent changes; missing DB; Dzen/VK route denial and no fallback. Owner UAT checks that the preview explains the blocker without requesting an external-send approval; client policy behavior must be observed, not inferred from unit tests.

Rollback: remove new discovery/registration; keep old APIs and all history. No migration needed if the read model can use current canonical records. If implementation exposes a new schema/role decision, return it as an approval delta.

## Authorization envelope

Design approval would authorize synthetic acceptance/tests and local implementation only. No public code export, merge/deploy, permission edits, credentials, live publication or provider smoke is implied. These operations require their own existing or fresh explicit authority.
