# Historical browser recovery: synthetic Docker verification

Uses existing reviewed Linux amd64 dependency image `planner-owner-manual-confirmation:20261020` and the repository's existing PostgreSQL16 test configuration. No production secrets, provider browser, publisher or queue consumer. The dedicated internal subnet avoids Tower's exhausted automatic address pool. Source is read-only; results are in `/tmp/contentops-legacy-browser-results`. Build is bounded to4GiB/2CPU, Node heap3072MiB; tests/database retain explicit CPU/memory/PID/log bounds from their reviewed Compose parents. No host ports, Docker socket, privileged mode or host-root mounts.

```sh
mkdir -p /tmp/contentops-legacy-browser-results
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml config --quiet
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml --profile build run --rm --no-deps build
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml up -d --wait synthetic-db
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml run --rm tests node node_modules/prisma/build/index.js db push --schema /workspace/prisma/schema.prisma
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml run --rm tests
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml ps
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml logs --tail 30 synthetic-db
docker compose -f ops/legacy-browser-recovery-tests/compose.yaml down
```

`db push` initializes only the fresh disposable synthetic database; it does not prove production migration readiness. This change adds no schema delta. Existing synthetic fixtures reject any database URL other than the named synthetic container/database/user. Temporary jobs remove themselves; `down` removes only this stack, without volume deletion. Health is PostgreSQL's declared `pg_isready` check and zero test exit status. Preserve result logs; never substitute a native host test run.
