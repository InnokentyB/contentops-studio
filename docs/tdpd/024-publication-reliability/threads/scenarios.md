# Approved Threads acceptance coverage

Owner approved the five design packets on 2026-10-19: «Утверждаю пять пакетов».
Scope: synthetic implementation only, no real provider/network publication.

| ID | Operator-observable acceptance |
|---|---|
| T01 | Generic release accepts tenant-owned manifest without fixed business identifiers; owner/manifest/account/package guards remain. |
| T02 | Container-create fence commits before POST; container ID persists before publish fence/POST; post ID persists before readback GET. |
| T03 | Failure of either durable fence/ID write causes no following side-effect call. Lost publish response never causes another POST. |
| T04 | Known-post readback restores the same attempt/fact; exact replay returns canonical result. |
| T05 | Missing post ID and history candidates remain held; no provider publish/status POST. |
| T06 | Wrong account/body/URL/time/reply/media and malformed provider payload cannot write a fact. |
| T07 | Tenant/release/package/hold change, stale lease/generation and concurrent completion fail closed. |
| T08 | Durable read budget (3 rounds,20 requests,180 seconds) and cancellation cannot reset through replay. |
| T09 | Fact+attempt+recovery+audit commit together; conflict/rollback yields no partial confirmation. |
| T10 | Actual generic MCP operator boundary serializes cause/remedy without secrets; historic routes and duplicate policy unchanged. |

RED first: existing verified transport cannot persist stage/IDs, and no generic API recovery exists. Tests use native node:test/ts-node inside reviewed Node Docker image; real isolated PostgreSQL exercises persistence and finalizer races. Every build/result/error goes to TRUN. Official status contract is not verified, so that optional capability remains disabled; direct known-post GET is the implemented recovery scope.
