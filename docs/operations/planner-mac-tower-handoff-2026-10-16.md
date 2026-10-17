# Planner Mac → tower: read-only boundary handoff

Observed 16 October 2026, approximately21:20 Europe/Lisbon. No process was
stopped, no app started and no backup/database/publication mutation performed.
This is a handoff, not cutover authorization or a verified migration backup.

## Actual Mac runtime

- LaunchAgent: `com.analystcraft.ba-post-planner-mcp-uat`;
  plist `/Users/innokentyb/Library/LaunchAgents/com.analystcraft.ba-post-planner-mcp-uat.plist`.
- WorkingDirectory: `/Users/innokentyb/Ba_post_planner`.
- Program invokes `/bin/zsh` and `dist/mcp/remote-server.js`; full shell command
  and environment were not printed because they may contain credential terms.
- Node PID1061 and local PostgreSQL PID1051 were running since
  16October19:47:29 Lisbon. Loopback8080/5432 come from the migration owner's
  observation; no second service/consumer was activated here.
- Current on-disk `dist/mcp/remote-server.js` SHA256:
  `7eaba978f3e7537d048a165f74b3c3dee020520845858f8bd41b101c7eddf214`.
  This is NOT proof of the already-loaded in-memory modules or build revision.

Primary checkout HEAD was `f7b259318f04466e28bca5f145e7638a1544baf7` on
`codex/x1113-native-executor`, with unrelated staged/untracked work and unresolved
merges in `src/services/exact_owned_route_guard.ts` and
`docs/tdpd/dzen1002-manifest-drift-minimal-delta.md`. Do not build/reset/stash or
declare this mixed checkout a canonical clean source. Preserve source, index,
unmerged stages, dist and private configuration before any eventual cutover.

This audit's clean review worktree is
`/Users/innokentyb/.codex/worktrees/linkedin-991-owner-release/Ba_post_planner`,
branch `codex/runtime-policy-audit`, base
`12025f29ddf51d30e90825caf2d90e09e1045a1b`. It changes only developer policy/audit/
checks, NOT publication runtime. Its base is the audited main revision, not proof
that it matches Mac-loaded runtime or the latest production deployment.

## Local DB observation, not a retirement clearance

One read-only `pg_stat_activity` snapshot showed zero other client backends.
Idle pools can reconnect: this does not prove no application depends on PG5432.
Non-template DBs visible: `ba_post_planner_disposable_test`,
`ba_post_planner_tdpd_004005`, `ba_post_planner_tdpd_20260811`, `postgres`,
`seturon_dev`, `seturon_pcf_slice_test`, `seturon_test`.
No active-client database/role mapping or effective MCP DATABASE_URL was proven.
Do not infer the MCP uses this local DB, or retire unrelated Seturon databases.

Source schema uses PostgreSQL namespace `planner`; latest tracked migration at
the clean audited base is `20261013110000_vk_connector_provider_mode` (preceded by
VK dispatch/provider-fencing). Actual applied migration status, data parity,
role grants, backup freshness and restore verification remain UNVERIFIED.
Primary schema SHA256 `bcd1e1dccf7a0d95f91d8feef36b21f955f122bce8e510fa2aba9008488b160b`;
primary package-lock SHA256 `2de7663433406f8e0ca2b84b55fc953a380327cfe7a7eeba3eba309568701776`.
No passwords, tokens or authorization material are part of this handoff.

## Separate migration-owner readiness evidence

Read `/home/innokenty/migration-evidence/overnight-20261016/planner/readiness.json`:
`BLOCKED_SAFE_SOURCE_PRESERVED`. It reports frozen-current-dist image built,
30 COPY tables/771 rows restored and counts matched in an isolated PG15; no real
integration credentials, no published ports; unauthenticated MCP401, health500.
Those restore checks are the migration owner's evidence, not this audit's test.
The smoke app was removed/recoveryDB stopped according to that handoff; source
Mac services stay running. This is not cutover readiness.

Source explains the compatibility failure: `src/mcp/remote-server.ts:206–207`
calls `mcpAccessTokenService.configuredProfiles()` for health;
`src/services/mcp_access_token.service.ts:277` queries managed token records.
The canonical table creation exists in tracked migration
`20260831120000_add_mcp_access_tokens`, with subsequent profile/bundle/organization
changes in the September migrations. The reported source/restore absence of
`planner.mcp_access_tokens` is schema drift, not a reason to invent a new auth
table, bypass managed auth or enable credentials. Determine the actual migration
ledger and prerequisites on a verified restore first. Applying any migration,
issuing tokens/roles or changing the source DB remains a separate authorized step.

## Safe remaining boundary

Leave Mac running until the migration owner verifies a fresh recoverable backup
and explicitly reconciles effective config → actual DB/schema/roles → loaded
build/source provenance. An independent synthetic container may be prepared;
neither old tower source `ffe3435` nor restored historical DB is an activation
source. Keep background jobs, schedulers, publishers and queue consumers disabled.

Quiesce must deliberately stop admission for this one MCP instance, wait for/
inventory existing leases/attempts/jobs without resetting them, then stop this
launchagent under the agreed migration window. Do not infer that an idle DB
snapshot authorizes stopping shared PostgreSQL. UNKNOWN remains reconciliation
only, never replay as migration verification.

Container auth verification must use synthetic auth/data or documented read-only
health/capability calls with privately supplied scoped credentials. Verify health,
tenant/principal rejection and tool availability without invoking mutating tools.
Do not issue new token/role/profile permissions merely to make a smoke test pass.
No own service cutover, DB write or publication was performed by this audit chat.
