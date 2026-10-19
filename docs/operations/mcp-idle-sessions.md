# MCP idle-session lifecycle — MEMORY-001

The remote gateway retains authenticated SDK sessions in a typed registry. A session is eligible for cleanup after 30 minutes without authenticated activity, provided it has no executing HTTP handler and no open response stream. The gateway checks every 60 seconds. Requests that fail authentication, tenant scope or credential/endpoint binding do not refresh activity.

`src/mcp/session-lifecycle.ts` owns weak activity accounting, the non-overlapping unreferenced timer and exactly-once asynchronous server cleanup. `remote-server.ts` retains its existing authentication and capability checks. All six owner/scoped GET/POST/DELETE handlers track execution separately from response lifetime. The real SDK test pins the gateway's existing `enableJsonResponse:true` behavior: a disconnected long tool call remains pending until its actual callback finishes. Closing a socket does not cancel an executing tool. The same metadata object is tracked before and after SDK session initialization.

SDK clients normally open a GET/SSE stream: a connected stream remains protected even beyond the idle timeout. Cleanup addresses disconnected idle sessions; it does not promise a particular RSS reduction. Explicit process shutdown first closes admission (new authenticated requests receive HTTP503), stops the timer and drains actual executions, including disconnected entries already removed from the retained map, before closing streams or shared resources. Passive GET/SSE handlers are counted as open streams rather than business execution, so shutdown can close them after real work drains. Explicit SDK session termination also releases server resources. Cleanup failure emits the static `MCP_SESSION_CLEANUP_FAILED` event with an investigation action; no exception, session ID, credential or request payload is logged.

Unknown or expired IDs receive HTTP404 / JSON-RPC -32001 and require a new initialize exchange. Session expiration never grants a new publication attempt or a repeat of a potentially delivered operation. Clients must reconcile uncertain business operations independently of MCP reconnection.

## Configuration

Empty values use defaults; configure only the gateway service:

- `MCP_SESSION_IDLE_TIMEOUT_MS`: default1800000; integer100..86400000.
- `MCP_SESSION_SWEEP_INTERVAL_MS`: default60000; integer100..3600000.

Invalid values fail startup with `MCP_SESSION_POLICY_INVALID` without echoing the value. Small values are intended for isolated synthetic checks, not a production recommendation. No heap/memory cap changes are included.

## Container verification

Run from the repository root on Tower. The isolated Compose project uses Linux amd64, non-root/resource/log limits, read-only source, an internal network at10.231.75.0/28, no published port, and synthetic connection configuration only. Review overlap before creating this network. It reuses the reviewed `ops/quality/Dockerfile` with a separate `planner-memory-001:20261018` tag; other test images are not overwritten.

```bash
docker compose -f ops/memory-001/compose.yaml build checks
docker compose -f ops/memory-001/compose.yaml run --rm --no-deps --pull never checks node --test /opt/planner/dist/tests/mcp_session_lifecycle.test.js /opt/planner/dist/tests/mcp_session_sdk.test.js /opt/planner/dist/tests/remote_mcp_auth.test.js
```

The real SDK fixture is an isolated synthetic HTTP server with no business tool or provider connection. It verifies protected SSE, disconnected expiration, actual404, fresh SDK initialization, credential/endpoint separation and a60-session soak. Its RSS measurements include the test process and are not production estimates.

Quality gate requires this linked worktree's Git metadata mounted read-only. For the engineering snapshot used here:

```bash
docker compose -f ops/memory-001/compose.yaml run --rm --no-deps --pull never -v /home/innokenty/projects/ba-post-planner/.git:/git:ro -e GIT_DIR=/git/worktrees/contentops-memory-001 -e GIT_COMMON_DIR=/git -e GIT_WORK_TREE=/workspace checks npm run quality:gate
```

Adjust only these Git metadata paths for a different checkout. They do not grant application access to the Docker socket or host root. For finite background diagnostic execution, `docker compose -f ops/memory-001/compose.yaml up -d checks` starts the default test command; it exits when finished. Status/health is its exit code from `docker compose -f ops/memory-001/compose.yaml ps -a`; logs use `docker compose -f ops/memory-001/compose.yaml logs checks`. Stop/remove this isolated stack and network with `docker compose -f ops/memory-001/compose.yaml down`; no volume deletion is required or authorized.

## Controlled deployment and rollback

This patch has no schema migration, provider call, business-data mutation or scheduler change. Engineering checks do not establish production quiescence or owner UAT. Deploy only the exact reviewed commit to planner-mcp after an independently verified no-active-operation window; do not rely on a main push that may deploy other services. Public `active_sessions` is a retained-session count and does not prove absence of executing requests or open streams. If the safe window cannot be established, retain the patch and report the deployment blocker. Record and recheck the current successful deployment before any service-specific rollout/rollback; do not infer current production state from this document. Do not restart other services or treat a reconnect as authority to resend.
