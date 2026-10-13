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
