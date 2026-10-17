# Offline policy and build verification on tower

This stack runs only synthetic developer checks, never the application,
publisher, scheduler, DB or provider consumers. Copy a secret-free repository
snapshot with Git metadata to an isolated tower directory first; do not copy a
Mac node_modules tree or `.env`/credentials. All commands below run on tower.

```sh
docker compose -f ops/quality/compose.yaml build quality
docker compose -f ops/quality/compose.yaml run --rm quality
docker compose -f ops/quality/compose.yaml run --rm quality npm run quality:gate
docker compose -f ops/quality/compose.yaml --profile build build build-check
```

The build stage downloads only locked public dependencies and Prisma engine
artifacts, and compiles backend/frontend. It does not connect to the synthetic
loopback database URL. The test/gate container has no network, ports or secrets,
uses UID1000, read-only source/root, temporary bounded `/tmp`, private namespace,
no capabilities and explicit CPU/RAM/PID/log limits. No browser is launched.
Dependency installation and compilation stay inside the image build.

Nothing persists: jobs use `run --rm`; no `up` is needed. Health is the process
exit code plus JSON/TAP output. Logs stream to the caller. If a job is interrupted,
use `docker compose -f ops/quality/compose.yaml stop`; `down` removes this stack
only (never `down -v`). There are no project database volumes to delete.

The scanner uses `NODE_PATH=/opt/planner/node_modules`. Normal CI installs the
same existing dependencies with `npm ci --ignore-scripts` and invokes the same
test and gate scripts. No home-directory tooling is required.
