# X native state read: approved delivery scenarios

Authority: x-native-state-read-001-authority.json; exact v1.1 contract hash is
preserved. This is implementation/testing of one MCP read, not registration/send.

| ID | Rule / observable result | Layer |
| --- | --- | --- |
| READ-01 | Enabled Owner/Publisher command discovered, readonly/idempotent/closed-world; other roles denied; off flag absent | MCP/contracts |
| READ-02 | Principal overrides spoofed actor; foreign project denied; actual owner membership checked before scoped inventory | auth/real PG |
| READ-03 | Strict IDs/actor/hash and512byte args; cursor/limit/apply/unknown keys rejected | unit/service |
| READ-04 | Exact project/channel/task, non-X/foreign/missing uniform denial; inactive channel readable; deterministic missing/malformed/case binding | real PG/unit |
| READ-05 | Empty complete view, exact DTO, false effects; no JWK/token/nonce/error/lease/body payloads | real PG |
| READ-06 | Same/other-owner installation, revoked-setting/sticky-event, audit-only/missing/mismatch/fingerprint invalid correctly classified | real PG |
| READ-07 |21IDs/81audits/invalidsuffix/2049byte value never false absence/active; unseen revocation checked exhaustively | real PG |
| READ-08 | Old-revision/channel exact-task attempt/WI/dispatch/fact/currentrelease reflected; unrelated jobs excluded | real PG |
| READ-09 | READ ONLY+RepeatableRead snapshot, coherent concurrent writes; no write/dispatch/provider callbacks; before/after counts+hashes unchanged | real PG |
| READ-10 |2active transactions; third BUSY, timeout/exception cleans counter/pool,1000/1500/300/2000ms budgets; response32769bytes rejected | service/real PG |
| READ-11 |100reads at1RPS with2workers over limit-size state, p95<=750ms/p99<=1500ms; no pool leak | real PG/container load |
| READ-12 | Existing X signed lifecycle/shared browser/tenant, backend/frontend build and quality regressions | container/CI |
| READ-13 | Reviewed commit deployed both services, flag/health/auth preserved; sole Publisher authenticated exact-scope readback | production read-only |

Use existing Node tests, Prisma/isolated PostgreSQL Compose and reviewed build
image. No new test framework/provider fixture required. All project execution on
Tower in bounded containers; synthetic data only, no restored/production DB mounts.
Serialize database suites; cap pool4. Keep scenario-level RED/GREEN/errors and
real load measurements in TRUN. A result/receipt is not provider UAT or publication.
