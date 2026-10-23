# Approval-preserving Telegram readiness checks

Reviewed existing Linux amd64 dependency image: planner-owner-manual-confirmation:20261020. Synthetic PostgreSQL only, no production/provider credentials, no published ports, internal project-specific network. CPU/memory/PID/log limits and non-root/read-only workloads are inherited from the existing publication test Compose; build has no network. Output source/compile data use /tmp because Tower root storage is constrained.

From the checkout root:

```sh
mkdir -p /tmp/contentops-telegram-readiness-results
docker compose -f ops/telegram-readiness-tests/compose.yaml run --rm build
docker compose -f ops/telegram-readiness-tests/compose.yaml up -d synthetic-db
docker compose -f ops/telegram-readiness-tests/compose.yaml run --rm setup
docker compose -f ops/telegram-readiness-tests/compose.yaml run --rm tests
docker compose -f ops/telegram-readiness-tests/compose.yaml ps
docker compose -f ops/telegram-readiness-tests/compose.yaml logs --tail 20 synthetic-db
docker compose -f ops/telegram-readiness-tests/compose.yaml down
```

Container/test exit0 is the one-off job health check; PostgreSQL has a bounded pg_isready health check. Temporary jobs use --rm; down removes only this disposable stack/network. Never use down -v or production/restored data here. The ephemeral synthetic DB has no backup requirement. No persistent worker, scheduler or publisher is started.

Owner UAT after an authorized release: on the existing authenticated Publisher, prepare a genuinely approved exact Telegram task; expect ready_for_execution and unchanged approval_required mode/text/revision/asset/review. Observe actionable hold/conflict errors rather than repeating review. Preparing is not a GO or a send. Release and actual sole-Publisher publication require their own existing authority and actual provider evidence.
