# Shared dispatch/readiness synthetic checks

Tower Linux amd64 Docker only. Uses the existing reviewed planner-owner-manual-confirmation:20261020 dependency image; no production credentials, accounts, provider calls, browser sessions or application startup. Build/test services are non-root, read-only, network-none with inherited CPU/memory/PID/log limits. Source is read-only; output is /tmp/contentops-shared-dispatch-results. Separate PostgreSQL uses synthetic credentials, an internal project network10.231.118.0/28, bounded tmpfs and no published ports. It must not be connected to restored/live data. A network overlap is a setup failure; inspect current networks and choose a free project-specific subnet, never delete another network.

Build: `mkdir -p /tmp/contentops-shared-dispatch-results` then `docker compose -f ops/shared-dispatch-tests/compose.yaml run --rm --no-deps build`.
Temporary focused test: `docker compose -f ops/shared-dispatch-tests/compose.yaml run --rm --no-deps tests`.
Start/check synthetic PostgreSQL schema: `docker compose -f ops/shared-dispatch-tests/postgres.compose.yaml run --rm setup`.
Real PostgreSQL boundary tests: `docker compose -f ops/shared-dispatch-tests/postgres.compose.yaml run --rm tests`.
Health/status: `docker compose -f ops/shared-dispatch-tests/postgres.compose.yaml ps -a`; database healthcheck is pg_isready, test health is TAP/exit code.
Logs: `docker compose -f ops/shared-dispatch-tests/postgres.compose.yaml logs --tail 30 synthetic-db`.
Stop: `docker compose -f ops/shared-dispatch-tests/postgres.compose.yaml stop`.
Cleanup own temporary stack: `docker compose -f ops/shared-dispatch-tests/postgres.compose.yaml down`. No down-v, volume/network pruning or database deletion. No volumes are created; retained output logs remain outside containers.

CI reuses its existing compiler image and isolated synthetic DB. New tests are wired into the existing no-provider MCP and PostgreSQL stages. Tests never need a live token. Existing exact provider execution/approval/history guards and runtime-policy baseline remain unchanged.
