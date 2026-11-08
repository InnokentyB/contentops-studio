# Hourly coordinated settings cache — verification6November2026

Owner approved hourly TTL + cross-process invalidation design delta. Local implementation only. Base42b117b, preserving the prior MCP usage and backup changes. No production reads/writes, deployments, flag changes, billing changes or provider actions were part of this implementation.

RED: hourly/cross-process acceptance initially failed because coordination was absent. First real PG run additionally exposed unsupported void lock results through Prisma; lock return casts were corrected without relaxing fencing or the tests. Final runs use current source compiled into ephemeral Docker output, not stale image JS.

GREEN:
- TypeScript backend compilation PASS.
-11 focused Node tests PASS: one-hour lazy expiry,100-way single-flight, safe invalidation of old fills, failure bypass, scope/capacity bounds, MCP usage/auth checks, existing settings PUT refusal before mutation when coordination is absent.
-10 real PostgreSQL/Redis scenarios PASS: original MCP revocation/membership and backup SQL compatibility; production reader in TWO separate Node processes with actual existing settings PUT;100concurrent post-save reads require exactly one new DB load; writer killed after DB commit; private outbox events isolated from task tracker; Redis metadata loss while transaction open; unavailable Redis; paused old DB load after acknowledged save; durable abort fences late original; cache-disabled writer with cache-enabled peer; database/tenant Redis namespace isolation.
-1 actual Redis PROCESS stop/start scenario PASS. Writer killed after durable commit, reads stay fresh during outage; durable invalidation rebuilt and drained after service restart. No mock restart/native-stop claim. Host script only orchestrates Docker. Fault injection is restricted to the synthetic DB/Redis bindings.
-22 existing MCP workspace/profile/tenant authorization regressions PASS.
-8 unchanged Python backup policy/driver scenarios PASS.
-Total52 scenarios,0failed,0skipped. No provider UAT or measured production savings claimed.
-Quality gate PASS77,6823 findings/baseline unchanged, no hard stops. Scanner/baseline untouched. git diff --check PASS.

Delivery: hour-long cached reads default OFF through SETTINGS_CACHE_ENABLED=false until all web/MCP writers and existing task-tracker consumers run upgraded code with matching DB/Redis bindings. Writers always use coordinated invalidation, even when read cache is off. A mixed old-code/new-cache deployment is not supported. Disable cached reads on every instance before rolling back old writer code. No new migration/library/queue worker. Cache recovery is a bounded internal metadata loop, not an hourly full-settings refresh.

Operator UAT and public PR/deploy/activation remain separate. Local temporary PostgreSQL/Redis stack removed after verification; private production archives retained. Existing initial verification record describes the earlier60s candidate and is superseded for settings by this report.
