# Database egress reduction — local candidate

Owner approved the LOCK/QAR/ARCH/RISK and routine24h recovery point on6November2026. No production installation, credential change or scheduler activation is included.

## Settings: coordinated one-hour cache

Owner approved the design delta on6November2026. The actual MultiAgent reader caches only explicitly listed prompt/model keys for3600seconds, bounded1000entries per process. Expiration is lazy, not an hourly polling job. Tokens/credentials/rights/accepted content/publication state bypass caching. Shared Redis revision checks surround local cache hits; Redis stores only coordination metadata, never prompts, model values or credentials.

The existing settings PUT and missing-default creation use the same writer protocol: persist a prepared invalidation event, take transactional PostgreSQL global/shared and per-setting locks, install a Redis writer barrier, then commit setting plus committed event phase atomically. Redis invalidation completes before normal success acknowledgement. Independent writer barriers and revision checks prevent stale in-flight reads from refilling the cache. Failed/abandoned prepared events are fenced through durable status before abort; a late original writer cannot mutate afterwards. Recovery marks invalidation events, not publication work. Existing task-tracker outbox routing excludes this private event type.

Redis loss makes reads use PostgreSQL. Before a cacheable mutation, unavailable coordination refuses the save with SETTINGS_CACHE_SYNC_UNAVAILABLE and a Redis correction step. If the DB committed but acknowledgement of invalidation is uncertain, SETTINGS_SAVED_CACHE_SYNC_PENDING says the setting was saved and warns against blindly repeating it. A durable pending barrier prevents stale hits; the cache-only recovery loop retries at5second intervals in bounded batches. A successfully applied invalidation with pending DB delivery status can be repeated safely. Startup/Redis metadata loss bootstraps outstanding barriers under an exclusive PG lock, so in-progress setting commits cannot be skipped. Retried delivery is idempotent. No new schema/dependency/provider queue is introduced.

Runtime modules are small; oversized existing route/generation/server files receive narrow delegation/lifecycle edits. No unrelated baseline decomposition.

### Installation boundary

SETTINGS_CACHE_ENABLED defaults false. This gates reads only: upgraded writers always coordinate, so off/on read-cache instances remain compatible. Before enabling on any instance, all web/MCP settings writers and task-tracker consumers must be on the upgraded code; old code does not emit invalidation events. Verify the same DB connection identity and Redis binding for web/MCP. Redis metadata namespaces hash host/port/database/user without passwords. Prefer the existing private Redis endpoint. No production flag has been changed. Before code rollback, disable cached reads on every instance and wait for in-flight settings operations, then roll back. Default-zero activation here is intentional, not evidence of a deployed cache.

The dedicated lazy Redis client never imports src/queue or starts BullMQ/provider consumers. Server and MCP shutdown close the cache recovery loop/client before their database resources. No paid service, secrets, schema migration or persistent operator daemon is introduced.

Comparable production egress measurements and OwnerUAT remain separate; cumulative historical counters do not prove exact hot setting keys.

## MCP

Token/profile/expiry/revocation and current membership are read for each authenticated request. Permissions are not cached. Credential lookup selects minimum fields; its hash is calculated from the received bearer. Coarse last-use updates coalesce for60seconds within a process, bounded1000entries. Conditional database UPDATE across instances prevents repeated recent timestamp writes and returns a count, not credential rows. Errors propagate; the next request can retry. last_used_at is operational metadata, not a per-request audit or evidence of an idle Publisher. Authentication reads remain necessary; this package does not claim zero database calls for MCP.

## Backups

The new operator driver preserves full logical dump behavior, adding a private filesystem execution lock and archive reuse. No daemon is started. The explicit --code-only mode reuses an archive only when its hashed database connection binding and schema fingerprint match, it is younger24h, archiveSHA matches and a matching isolated restore receipt is successful with zero invalid constraints. Old receipts without binding/schema cannot authorize reuse.

For migrations/destructive work use --backup --force-reason with the reviewed operation reference. Force never bypasses locking, collision checks or disk reserve. Code-only rollback preserves the database. Routine recovery can lose up to24h of changes. Existing archives are retained. No incremental/WAL/PITR claim is made.

Schema fingerprint covers columns/types/defaults, constraints, indexes and the migration ledger, not every semantic object such as function bodies. Reuse is limited to reviewed code-only releases without migration or unreviewedDDL. It never asserts unchanged business data. Archive binding hashes host/port/database/user; credentials are not persisted. A private matching *.receipt.json from a real isolated restore must contain status RESTORE_VERIFIED, archive, sha256 and invalid_constraints0. Never manufacture that evidence.

Admin Compose is deliberately explicit: private existing CLI credentials/home and backup directory are mounted only for the chosen operator job. No source secrets are included. CONTENTOPS_BACKUP_DIRECTORY is a test/operator path override; production leaves it unset at /backups. The archive does not contain external Storage objects. Use the existing reviewed isolated restore procedure before reuse.

## Docker commands

Run checks, python-checks or postgres-checks through ops/egress/compose.yaml using docker compose run --rm. EGRESS_TEST_IMAGE overrides the existing compiler image; ops/quality/Dockerfile target buildcheck provides the equivalent. Cleanup is docker compose down, never down -v. The database uses synthetic credentials, an internal network and temporary storage; no provider or production data is attached.

Quality uses the repository's unchanged quality gate. Backend TypeScript compilation and focused/regression tests run in the compiler job. Python tests use the existing reviewed backup image. Actual production enablement and Owner acceptance are separate.

Operator command after separate production readiness: docker compose -f ops/egress/admin.compose.yaml --profile admin run --rm backup --backup --code-only. For data/schema migration include --force-reason followed by the reviewed operation reference. The admin job is never part of test Compose and has not been run against production in this change. Build equivalent backup image with Dockerfile.backup; it copies no source or credentials. Stop/remove its empty network with admin Compose down after a job. No cron activation is included.

Routine preflight hashes a tiny catalog/migration result, not whole-table business content. Connection identity mismatch, missing ledger, active backup or archive collision stops with a reason; no automatic deletion/overwrite. Operators must retain current code-only classification when reusing a snapshot. A change to stored functions without a migration is unreviewedDDL and must not reuse the snapshot.

If an eligible verified archive exists but neither --code-only nor --force-reason is supplied, the driver stops with BACKUP_CLASSIFICATION_REQUIRED and an exact corrective command. It never silently reuses a pre-migration snapshot for an unclassified operation, or downloads another identical full backup by default.

Cross-process/restart verification: run postgres-checks for real PostgreSQL/Redis and separate Node processes; then sh ops/egress/restart-check.sh for an actual stop/start of the ephemeral Redis service. The script runs Docker only on the host. All destructive fault injection is guarded to the isolated Redis URL and synthetic database name. Node and Python test logs may include expected synthetic outage diagnostics, never production values.
