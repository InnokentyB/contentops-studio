# DZEN1002-MANIFEST-001 — approved exact decision packet

Approved2026-10-16, direct human reply
`01a14420-4343-7460-8797-68ec62b0ba86` in Portfolio OS:
“Утверждаю DZEN1002-MANIFEST-001”. The proposal below is retained as the
approved scope; delivery evidence is in dzen1002-manifest-fence-delivery.md.

## Why a decision is required

The approved DZEN1002-NATIVE-DIAG-001 verdict explicitly excludes manifest
rebinding (docs/tdpd/dzen1002-inventory-repair.md, Recorded verdict). The governed
route also requires stale pinned approval to stop. Publication GO and the valid
release audit3126 do not override that exclusion. This is not a request to
approve the content or release again.

## Verified defect

`DZEN1002_ROUTE.manifest` is
`sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b`.
Both release and preflight MCP schemas derive a literal from it; assertScope
requires the same value. Preflight additionally compares live manifest equality.
The independently read current p10 manifest is
`sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7`.
Thus current checksum fails schema; old checksum fails live comparison before
provider access. There is no checksum that can pass both today.

Dedicated publish has no manifest input/check at its MCP boundary; it relies on
the exact release/package and stored preflight readiness. Do not claim that
publish independently enforces the preflight's current-manifest fence.

## Exact requested LOCK / QAR / ARCH / RISK delta

- LOCK: accept only the explicitly reviewed current checksum above for this
  existing p10/task1002 route. Preserve body/rev3/decision300v2/asset151, dates,
  approvals, immutable audit3126, attempts and all adapter-only/denial rules.
- QAR: release and preflight accept that exact checksum and reject old, malformed
  and arbitrary checksums before provider/storage mutation; a later live manifest
  change blocks again. Publish dry-run/live admission must enforce the same
  current checksum before any attempt or provider operation, including cached
  readiness. Never derive approval automatically from the live checksum.
- ARCH: one task-specific manifest constant shared by the dedicated boundaries;
  no new provider/session/adapter/authentication route. Add an internal read-only
  current-manifest guard to dedicated publish, with compatibility for unrelated
  task routes. Do not rewrite the historical release event to claim it was issued
  under a newer manifest, and do not call release again merely to renew proof.
- RISK: fail closed on foreign tenant, non-owner scope, stale manifest, existing
  uncertain attempt and missing adapter admission. Updating the checksum does
  not clear any denial or authorize provider access. Rollback disables the
  affected route/returns stale; retain all historical attempts and facts.

## Test-first acceptance after approval

1. RED: current checksum rejected by pinned schema/guard; publish lacks independent
   manifest fence. Deterministic fixtures only, no native provider requests.
2. GREEN: current exact schema + live match succeeds to mocked preflight;
   old/arbitrary/malformed values, live drift and foreign scope yield zero
   provider calls, zero attempts, zero release/fact writes.
3. Existing audit3126 is not updated/replaced; package guards and denial tests
   remain effective. Cached preflight cannot bypass publish's manifest fence.
4. Focused tests, backend build, quality gate and independent review must pass
   before merge/deploy. Deployment is separate from permitted native UAT.
5. Owning Publisher then receives the dedicated preflight command only; it must
   still stop at denied/unavailable adapter admission. No send in this repair.

Original decision request: approve DZEN1002-MANIFEST-001 exactly as above. No
production data, release or provider action was changed by the proposal.
