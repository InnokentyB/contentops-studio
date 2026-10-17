# Isolated shared-publication transaction checks

Only synthetic PostgreSQL and test jobs, never the application/publisher,
restored data, credentials or provider/browser access. Run on tower only.
No host ports, public network, named persistent volumes or Docker socket.
Both services have non-root users, read-only roots, bounded tmpfs/resources and
no capabilities. Database credentials below are deliberately synthetic.

Build the reviewed image first using `ops/quality/compose.yaml --profile build
build build-check`, then from this isolated secret-free source copy on tower:

```sh
docker compose -f ops/publication-tests/compose.yaml up -d synthetic-db
docker compose -f ops/publication-tests/compose.yaml run --rm tests node node_modules/prisma/build/index.js db push
docker compose -f ops/publication-tests/compose.yaml run --rm tests
docker compose -f ops/publication-tests/compose.yaml ps
docker compose -f ops/publication-tests/compose.yaml logs --tail 50 synthetic-db
docker compose -f ops/publication-tests/compose.yaml down
```

Health: database healthcheck plus test exit code/TAP. Stop interrupted work
with `docker compose ... stop`. `down` removes this named synthetic stack and
its private in-memory fixture database; never use `down -v` or volume pruning.
This does not touch any other stack, production, migration archives or backups.
