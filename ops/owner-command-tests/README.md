# Owner-command checks on Tower

Existing reviewed Linux amd64 dependency image: planner-owner-manual-confirmation:20261020. Compose reuses project synthetic PostgreSQL16 and reviewed resource/security limits. No provider credentials, host ports, persistent consumers or production data. Build source is read-only and network-isolated; only synthetic tests access the internal network. Results: /tmp/contentops-owner-command-results.

From the checkout root:

```sh
mkdir -p /tmp/contentops-owner-command-results
docker compose -f ops/owner-command-tests/compose.yaml run --rm build
docker compose -f ops/owner-command-tests/compose.yaml up -d synthetic-db
docker compose -f ops/owner-command-tests/compose.yaml run --rm setup
docker compose -f ops/owner-command-tests/compose.yaml run --rm tests
docker compose -f ops/owner-command-tests/compose.yaml ps
docker compose -f ops/owner-command-tests/compose.yaml logs --tail 30 synthetic-db
docker compose -f ops/owner-command-tests/compose.yaml down
```

Exit0/test results are the job health check. setup pushes the reviewed schema only to the disposable synthetic-db. Temporary jobs use --rm; down removes only this synthetic stack/network, without volume deletion. Do not feed restored production data or secrets to this test configuration.
