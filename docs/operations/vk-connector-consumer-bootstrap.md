# Standalone VK infrastructure consumer

Bundle 016 authorizes infrastructure only. Infrastructure mode accesses no VK profile and creates no publication attempt or
fact. Delta017 adds a prepared provider surface; its production admission remains
`PERMISSION_UNVERIFIED` before loading browser/UI code or accessing a profile. A valid receipt ends `blocked / PROVIDER_CONTROL_DENIED`. Railway deployment
does not install or start this local process.

Use existing authorized project 10 Publisher MCP credentials. This guide does not
provision a new credential. Prefer the already-existing process/LaunchAgent memory
environment `CONTENTOPS_ANALYSTCRAFT_PUBLISHER_TOKEN`. The config stores only its
name, never its value. Alternatively reference an existing owner-only regular token
file with mode `0600`; config and token symlinks are rejected. Never put a token in command
arguments, config JSON, job packages, service-manager environment or logs.

Private configuration (absolute paths, file mode `0600`):

```json
{
  "projectId": 10,
  "hostId": "vk-connector-local-1048",
  "endpoint": "https://planner-mcp-production.up.railway.app/mcp/publisher",
  "tokenEnvVar": "CONTENTOPS_ANALYSTCRAFT_PUBLISHER_TOKEN",
  "runtimeDir": "/absolute/private/vk-connector-runtime",
  "mode": "infrastructure_only",
  "buildVersion": "reviewed-build-revision"
}
```

Set exactly one source: the pinned `tokenEnvVar` above, or `tokenFile` with an
absolute existing private file path. Both together, any other environment name,
and an empty/missing environment value are rejected. No token is copied into a file.

The endpoint, project and host are pinned. No browser/profile or policy-admission option exists. Mode `vk_feed_provider`
selects only the prepared execution surface and never grants permission. Its idle
and blocked health uses `PROVIDER_PERMISSION_UNVERIFIED`; `infrastructure_only`
retains the previous infrastructure blocker. The runtime directory must belong to the process owner with mode `0700`.
After the backend build, the reviewed command is:

```sh
node /absolute/checkout/dist/workers/vk_connector_consumer.js /absolute/private/config.json
```

For macOS LaunchAgent setup, use this command as `ProgramArguments`, no shell and
no `EnvironmentVariables` secret. The service inherits the already-existing
launchctl memory environment; this guide does not set or persist it. Keep the service disabled until backend migration,
restricted MCP tooling and infrastructure smoke are verified. The agent must run
as the configuration/token owner. SIGTERM/SIGINT stop polling and close MCP before
releasing the local lock. Polls are serial every 5 seconds; request/connect timeouts
are 15 seconds; failed-control backoff caps at 60 seconds.

`consumer.lock` is exclusive `0600` and contains only process ID/UUID/mode. A competing
consumer fails closed. A clean restart obtains a new instance UUID and server
fencing generation. Crash/stale lock recovery is deliberately manual: stop the
managed service, inspect its PID and process identity, confirm no consumer remains,
review canonical job/attempt state, and only then remove the stale lock. Never
remove a lock from a running consumer or reset an uncertain publication to retry.

Local `health-<instance UUID>.json` files are `0600` and contain safe infrastructure
receipts only. A local timestamp or process presence does not prove a server
heartbeat, provider login, permission or publication. Query
`ba_get_vk_connector_health` and `ba_get_vk_connector_job` through the authorized
MCP identity for canonical status. OFFLINE after heartbeat freshness expires,
auth unavailable, disabled dispatch and provider-blocked are distinct from success.

Pilot restrictions are project 10/task 1048/channel 117/community-240051152,
revision 1 / asset 130 / feed and valid immutable body/asset/release hashes. Only explicit
queued dispatch jobs are consumed; the process never harvests all publication tasks.

For a stable installation outside a managed checkout, run `npm run build:vk:connector`
after installing the frontend build dependencies. This reuses the locked frontend
esbuild and produces `dist/connector/vk_connector_consumer.cjs`, a standalone file
with no checkout/node_modules dependency and no embedded credential. Copy that
reviewed file into a private versioned release directory; use the installed Node
executable, copied artifact and private config as LaunchAgent ProgramArguments.
The preferred credential source is the existing pinned launch environment; the
LaunchAgent contains no raw token EnvironmentVariables.

## Explicit human operator handoff

The managed command above never injects the provider runtime. Resource fields
`profileDirectory` and `evidenceDir` are optional absolute paths in the existing
private config; they do not grant permission or activate the managed consumer.
The existing profile resource is
`/Users/innokentyb/Library/Application Support/ContentOps/vk-browser/profile`.
The operator launch validates that it already exists; it never provisions a new profile.

A human operator can use the reviewed checkout and its pinned dependencies with:

```sh
node dist/workers/vk_connector_consumer.js --operator-run /absolute/private/config.json
```

This entry requires installed Playwright and its matching browser assets. The
standalone artifact remains dependency-free for managed infrastructure mode;
operator mode additionally requires resolvable pinned Playwright dependencies.
Stop the managed consumer first and retain its exclusive-lock safeguards. The
operator entry uses the same existing Publisher credential, immutable package,
application-host challenges, scoped heartbeat, generation/lease fences and durable
attempt. Wall and confirmation evidence include original-photo identity and byte
hashes; missing absolute dates, incomplete pagination or changed/re-encoded image
bytes leaves verification required and cannot publish again automatically.

On 2026-10-13 the agent's attempt to open the owned community was explicitly denied
by site-safety, including indirect execution through another browser or adapter.
The agent must not invoke this entry or install it in the managed LaunchAgent to
obtain that prohibited outcome. Application challenges authorize product actions;
they do not clear that tool restriction. This is a handoff to the human operator,
not a live validation result. Live VK selectors and original-download availability
remain unverified; local tests use fresh network-blocked contexts only.

For the SAME frozen verification-required job, the explicit human recovery entry is:

```sh
node dist/workers/vk_connector_consumer.js --operator-reconcile /absolute/private/config.json
```

It registers the current host, reads pinned job
`3f9f1d08-1d1f-49a9-8f2c-cc17d00ac2de`, rebinds with exact generation/hash CAS,
and performs read-only reconciliation. Proven absence cannot acquire a send lease;
this entry never resumes or resets the uncertain attempt. All resource directories
must already exist, be owned by the current user, mode `0700` and non-symlinks.
Context cleanup has a 30-second deadline. Unconfirmed cleanup stops provider work,
quarantines further sessions and preserves the lock for explicit operator review.

## Single mandatory operating source

Follow `docs/operations/vk-owned-publication-route.md`. Documented Planner command
-> registered independent adapter is the only governed Dzen/VK route. Codex never
opens Dzen or VK with CUA/ComputerUse or private tabs/CDP/session injection, including
preflight and UAT. Not-ready/failed adapter -> BLOCKED + repair, no browser/API/
worker/chat/manual fallback. Existing action/site denial and uncertain no-retry rules
remain unchanged. This bootstrap does not activate provider execution.
