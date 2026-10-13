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
