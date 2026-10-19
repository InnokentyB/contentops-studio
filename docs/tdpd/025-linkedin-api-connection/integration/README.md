# Final local engineering verification

Owner-approved LOCK-025 implementation only. Production, credentials, provider sends and Owner UAT remain outside this result.

Backend and frontend build PASS in Docker image `sha256:80d405eebe482e3231c81e5d52ccc0f6ce06a5169ac4058cc424b5f97a3f8372`. Every file under `src`, `prisma` and `frontend/src` was compared by SHA256 between the image and final worktree: identical. Schema SHA256 `b9200f3b9ce6f3a1d669368c607d3a1207871b8cdb4362fbd290c51ca69445a6`.

Final checks, zero skipped: 14 compiled API tests; 15 actual SDK MCP/media tests; 31 actual HTTP/PostgreSQL OAuth tests; 5 channel PostgreSQL tests; 20 canonical API PostgreSQL tests. Affected existing regressions passed 51/51; independent Threads boundary/recovery checks passed 31/31. Provider calls are synthetic fixtures. Quality gate PASS, score77, runtime policy7093/7093, no new exemptions or hard stops.

The first combined run passed compiled and MCP/media checks, then exposed one stale OAuth assertion using the renamed `image_read` field. The test now asserts `image_read_permission` and `image_read_probe:not_performed`; all PostgreSQL suites passed on repeat. This was a test-contract mismatch, not feature RED. Earlier meaningful RED evidence remains under oauth, review and integration.

A proposed `/source/logs` tmpfs failed before container startup because its mountpoint was absent in the read-only source mount; it was removed. Synthetic legacy entry-point tests may emit `PUBLISHER_LOG_WRITE_FAILED`: console diagnostics work, while the test source tree is intentionally read-only. This does not establish production log storage failure. No assertion or guard was disabled for it.

## Reproduce in Docker

Use the reviewed `.github/workflows/linkedin-api-connection.yml` for a clean build and migration of three isolated databases. For the already-built local image, set `RELIABILITY_TEST_IMAGE=planner-linkedin-api:20261019` before Compose. Commands use `tests/tdpd/linkedin-api-connection.compose.yaml`; temporary jobs use `run --rm checks`, database startup uses `up -d synthetic-db`, health uses `ps`, diagnostics use `logs --tail 100`, cleanup uses `down` without volume deletion. No ports are published and the synthetic network is internal. Never use production credentials or restored business data for these tests.

Compiled default-off tests override `LINKEDIN_API_DELIVERY_ENABLED=false`; lifecycle tests use the synthetic-only true setting. OAuth, API and channel tests require their separate named synthetic databases. The historical posts-model migration gap is repaired only inside the explicitly asserted API synthetic fixture; no unrelated production migration is introduced.

## Remaining release and acceptance boundaries

Public export/PR and migration/deploy require approval of the exact prepared code. Before deployment: green CI, fresh verified production backup/restore and additive migration compatibility. Keep API admission and restricted personal read-scope request disabled. Privately configure the approved LinkedIn app and callback, complete human consent, then verify actual token grants, identity and supported reads. Read permission eligibility is not an actual image probe. Images require exact same-attempt AVAILABLE/owner evidence before Posts POST; an incomplete image remains held with no automatic preparation replay. Any uncertain send requires same-attempt reconciliation only. The historical frozen browser attempt remains unchanged.
