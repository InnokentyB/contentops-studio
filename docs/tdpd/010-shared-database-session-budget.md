# TDPD 010 — shared database session budget

**Status:** GREEN implementation pending production UAT

## Problem and boundary

`planner-app` and `planner-mcp` use the same Supabase session-mode endpoint. The
provider allows 15 sessions, while the shared runtime pool previously allowed each
process to open 15 sessions. Two healthy services could therefore request 30
sessions before deployment overlap, background work, or diagnostics.

The operator outcome is a bounded, visible per-process connection budget that
keeps headroom for both services and deployments without changing the paid plan or
mutating database data.

## Rules

- `DATABASE_POOL_MAX` is an optional integer from 1 through 5.
- The safe default is 4 sessions per process; two normal services request at most 8.
- Invalid configuration fails process startup instead of silently reverting to an
  unsafe or unlimited value.
- Basic and deep health evidence exposes `pool_max` without exposing credentials.
- Both production services receive the same explicit value during rollout.
- Graceful shutdown continues to disconnect Prisma and close the shared pool.

## RED/GREEN scenarios

- The absent resolver fails tests for the default, bounded overrides, and rejected
  unsafe values.
- GREEN proves the pure resolver and verifies that the actual exported PostgreSQL
  pool uses the resolved value.
- Production UAT requires three consecutive green deep-health checks and no new
  `EMAXCONNSESSION` scheduler or MCP errors after both services are replaced.

## Rollback

Restore the previous service variables and revert the pool-budget commit. Do not
blindly redeploy while session capacity is exhausted; coordinate replacement so
old instances release their pools before judging the rollback.
