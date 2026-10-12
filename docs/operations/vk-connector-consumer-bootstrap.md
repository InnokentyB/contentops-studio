# Standalone VK infrastructure consumer

Bundle 016 authorizes infrastructure only. This executable imports no browser or
provider adapter, accesses no VK profile, and creates no publication attempt or
fact. A valid receipt ends `blocked / PROVIDER_CONTROL_DENIED`. Railway deployment
does not install or start this local process.

Use existing authorized project 10 Publisher MCP credentials. This guide does not
provision a new credential. Keep its existing token in an owner-only regular file
with mode `0600`; config and token symlinks are rejected. Never put a token in command
arguments, config JSON, job packages, service-manager environment or logs.

Private configuration (absolute paths, file mode `0600`):

```json
{
  "projectId": 10,
  "hostId": "vk-connector-local-1048",
  "endpoint": "https://planner-mcp-production.up.railway.app/mcp/publisher",
  "tokenFile": "/absolute/private/existing-publisher-token",
  "runtimeDir": "/absolute/private/vk-connector-runtime",
  "mode": "infrastructure_only",
  "buildVersion": "reviewed-build-revision"
}
```

The endpoint, project and host are pinned. No browser/profile or live mode option
exists. The runtime directory must belong to the process owner with mode `0700`.
After the backend build, the reviewed command is:

```sh
node /absolute/checkout/dist/workers/vk_connector_consumer.js /absolute/private/config.json
```

For macOS LaunchAgent setup, use this command as `ProgramArguments`, no shell and
no token environment variable. Keep the service disabled until backend migration,
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
