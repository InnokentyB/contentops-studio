# Historical shared-browser preparation recovery

Status: APPROVED by direct Owner reply «Утверждаю дизайн и локальную реализацию» on 2026-10-22 (request call_9b383b5e13564f89a33d2c6cbf3d56e3). Source baseline `edef3a111d2ab4eb0b950f5ccde0ecf5828b13f2`; isolated branch `codex/shared-browser-recovery-20261022`. No production admission, mutations, new sender or deployment is authorized by this document.

## Problem and inspected evidence

The owning Publisher cannot continue an old shared-browser attempt whose lease expired before a recorded Submit permission. Generic diagnosis reports a missing reader, hiding the distinction between a pre-permit historical attempt and post-submit uncertainty. Publication authority already supplied by the Owner is not being requested again.

Read-only production inspection on 2026-10-22: project10/task1124, attempt47 pending/manual-confirmation, work2017 claimed/expired, canonical fact absent. No preparation ledger, browser recovery row or API custody row exists. The scoped workflow ledger has one start, zero pre-submit permits, zero uncertain and zero confirmation events. These counts do not prove executor quiescence, provider absence or absence of an out-of-band effect. No credentials, leases or content were selected. Business identifiers here are historical evidence, never executable admission constants.

Existing source: browser_preparation_storage.ts admits supervised attempts only at start; browser_preparation_resume.ts requires an existing trusted ledger and technical quiescence; browser_recovery_application.ts registers only an optional LinkedIn reader; shared Setka known-object reconciliation already works after an expired lease. Existing Docker regression ran 10 tests successfully: generic recovery boundary + shared Setka lifecycle, compiled reviewed tree matching baseline. This proves conservative current behavior, not availability of live provider readback.

## LOCK-028

Operator boundary: existing Owner-scoped shared-browser MCP/control plane and the sole owning Publisher. Implement a reusable preview/adopt operation for a historical attempt before its first issued permit. IDs, identity, manifest, exact accepted revision/body/asset/decision and approval bindings are validated data. No exact-task command or allowlist.

Preview is read-only and returns separate actionable blockers: stale package/approval, fact already present, any permit/possible dispatch, missing authoritative lifecycle coverage, missing registered supervisor, missing technical quiescence, unavailable permitted profile/duplicate reader, incomplete/ambiguous provider evidence, and active/concurrent operation. An expired lease or Owner absence statement alone never qualifies.

Adoption requires all of: unchanged tenant-owned accepted package and release; complete authoritative event/custody history excluding every issued permit and dispatch; a registered application-owned supervisor proving termination/fencing of all old/offline execution under a fresh scoped challenge; and fresh readback through the existing approved owning-Publisher route, with exact profile and duplicate checks. Caller booleans, screenshots alone, new idempotency keys or DB lease rotation cannot register those capabilities or supply technical quiescence. No unsupported Setka API endpoint or new browser/session is invented.

FOUND uses existing canonical same-attempt reconciliation and its current package/fact gates, without granting send authority. Verified pre-permit absence plus technical quiescence may adopt and resume the SAME attempt through the existing preparation ledger/outbox/generation mechanism. This is narrower than creating a new attempt and preserves the old attempt, work item and audit trail. If any permit/dispatch is possible, absence is incomplete, or the old executor cannot be fenced, remain UNKNOWN with a concrete corrective action. Post-submit retry/new attempt authority is excluded.

Adoption never submits. The sole Publisher picks up a current supervised generation, verifies the exact profile/package/visual/duplicates again and obtains the ordinary first single-use Submit permission. Existing Owner publication GO is retained subject to normal exact-package checks; no second sender or generic future publication authority is created.

## QAR-028

- Zero provider writes, facts or recovery mutations from preview; zero extra attempts or permits from adoption/replay.
- Adoption is atomic with audit and package/permission/fact revalidation; injected audit failure rolls everything back.
- Quiescence and readback share a durable maximum of 3 passes, 20 counted provider requests and 180 seconds. Repeated calls cannot reset it; every external operation respects cancellation/deadline.
- Race between first permit and adoption permits at most one path. Old generation/lease, late callbacks and revoked permissions cannot write after supersession.
- Cross-tenant, demo, non-Owner, changed release/revision/visual, already found fact and forged/unbound proof produce no unauthorized writes or provider calls.
- Exact existing object finalization is idempotent and keeps existing canonical fact history. No unsupported transformation or mere text match is authoritative absence evidence.
- Docker-focused acceptance, PostgreSQL concurrency/rollback, affected existing regressions, backend build and quality gate are mandatory. Human/provider UAT remains separate.

## ARCH-028

Reuse existing BrowserDeliveryRecovery and BrowserPreparationExecution, their transaction/generation guards, bounded coordinator and outbox/pickup. Define an explicitly versioned historical-adoption meaning rather than reinterpreting an old NOT_DISPATCHED flag. No new table is proposed; final schema compatibility must be proven before implementation claims.

Keep capability registration server-owned: no MCP input accepts a supervisor, reader callback, trusted-proof flag or new transport. The application must have real authenticated readback and supervisor implementations for the same approved executor. Synthetic ports can establish local invariants but must leave production capability unavailable. The current repository has no demonstrated Setka supervisor/reader runtime: this is a concrete live-readiness dependency, not a credential presumed missing or a reason to install another sender.

All legacy/current writers of claim/start/permit/uncertain/confirmation/reconciliation/facts/native callbacks must reject an adopted historical generation unless admitted by the same scoped internal capability. Preserve non-browser dispatch guards and all old UNKNOWN history. Do not bulk-process historical attempts or start a scheduler.

Rollback disables adoption/pickup and retains persisted holds, old/new generations and evidence. Never downgrade an adopted attempt into an old writer that ignores the fence; never reset publishing or delete attempts. Existing PR198/199 rollout is separate and is not retriggered.

## RISK-028

Primary failure is a duplicate public post. Zero permit events is necessary but insufficient; an already exposed permission, untracked transport, offline executor or unaccounted writer blocks adoption. A reader must report exact account, scope, coverage, freshness and eventual-consistency limits. A visible empty feed is not proof that a delayed provider operation cannot appear. Only the pre-permit path with complete no-dispatch custody can resume; possible post-submit effects remain held.

Proofs bind project/task/attempt/work/package/approval/generation/executor/challenge and expire. Store evidence hashes/protected references, no raw tokens, cookies, provider payloads or copy in diagnostics/audit. Recheck current authorization and package in the final transaction. Existing fact conflicts remain held, never overwritten.

## Approval boundary

The Owner approved local synthetic tests and implementation only. The prior LOCK023/024 approvals explicitly exclude historical adoption and new authority after uncertainty; they cannot silently approve this extension. AGENTS.md requires human LOCK/QAR/ARCH/RISK approval before scenarios. Exact code publication, migration/deploy, live capability admission and processing a historical production attempt require concrete readiness and the applicable release authority. Owner GO for the actual post is already recorded; it is not requested again.
