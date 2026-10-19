# Local acceptance and release boundary

Engineering verification is complete on the combined source. Owner UAT is still pending. Production has not changed, and no publication/provider call is part of this acceptance.

## Operator examples

| Situation | Specific result and supported next action |
|---|---|
| Threads result observed but database cannot save uncertainty | `THREADS_ATTEMPT_PERSISTENCE_UNAVAILABLE`: restore database access, inspect the original attempt and reconcile it. The post ID may not be saved; never send again. |
| Threads published ID durably known, transient GET unavailable | Bounded same-attempt GET reconciliation, at most three rounds/180 seconds. Cancellation or exhausted budget leaves the original attempt held. |
| Threads original post ID missing | `THREADS_RECOVERY_IDENTITY_UNAVAILABLE`: keep frozen; engineering must establish supported original-attempt correlation. Similar text in history is insufficient. |
| LinkedIn reader lacks trusted original-attempt identity or required grants | Held with supported-reader/identity/permission guidance. No inferred absence and no replacement publication. Actual reader credentials/receipt issuer are not registered by this implementation. |
| Owner requests a meaningful visual after accepted no-visual copy | New art-direction input preserves accepted revision/text and history. Source/generation and separate current visual review must complete. Generic work completion and old callbacks cannot substitute for those steps. |
| Old worker restores legacy no-visual fields | Execution returns `PUBLICATION_VISUAL_REVIEW_REQUIRED`; preview returns `PREVIEW_VISUAL_REASSESSMENT_REQUIRED`. The immutable Owner request still governs. |
| Preparation failed before any permit but no technical quiescence proof exists | `PRE_DISPATCH_PROOF_UNAVAILABLE`: repair/admit the owning executor's technical fence. No reset, new attempt, generic retry or manual proof flag. |
| Concurrent publication state change | `BROWSER_STATE_CONFLICT`: refresh task/work/audit state and reconcile any existing uncertainty. Raw SQL and private values are absent. |
| Local preview passes | `LOCAL_VALID` applies only to local checks. Provider, credentials and release readiness remain `NOT_CHECKED`; submission permission stays false. |
| MCP connection becomes idle or disconnects during work | Idle sessions are released; executing callbacks remain protected and drain before shutdown. No memory-savings claim. |

## Reproduce synthetic verification on Tower

Use the integrated branch checkout. All commands below execute project work inside Docker. The retained `planner-reliability-integrated:20261019` image is the verified local artifact; its identity and build are in `integration/trun.json`. To rebuild locally using retained dependencies:

```sh
docker build --network=none --memory=2g --cpu-period=100000 --cpu-quota=200000 -f ops/quality/Dockerfile.reliability -t planner-reliability-integrated:20261019 .
docker compose -f tests/tdpd/publication-reliability.compose.yaml up -d synthetic-db
docker compose -f tests/tdpd/publication-reliability.compose.yaml run --rm checks npm run migrate:deploy
docker compose -f tests/tdpd/publication-reliability.compose.yaml ps
docker compose -f tests/tdpd/publication-reliability.compose.yaml run --rm checks node --test --test-concurrency=1 /source/tests/tdpd/linkedin-recovery-postgres.test.cjs /source/tests/tdpd/browser-preparation-postgres.test.cjs /source/tests/tdpd/linkedin-preparation-integration.test.cjs /source/tests/tdpd/visual-reassessment-mcp.test.cjs /source/tests/tdpd/visual-reassessment-postgres.test.cjs
docker compose -f tests/tdpd/publication-reliability.compose.yaml logs --tail 50 synthetic-db
docker compose -f tests/tdpd/publication-reliability.compose.yaml down
```

The CI workflow `.github/workflows/publication-reliability.yml` contains the full three-database matrix and explicit CJS suites. Its remote run has not occurred. Do not use `down -v`, prune or production credentials. The central verification stack was stopped after engineering checks; synthetic tmpfs data is intentionally temporary.

## Owner acceptance

Review the examples against actual scenario-level outputs in `integration/`. Confirm that accepted text/history are preserved, blocked cases name a reason and correction, no stale callback obtains send permission, and known delivery uncertainty always leads to original-attempt reconciliation. This review is separate from engineering PASS.

Live rollout remains a separate concrete release: public source export/PR, remote CI, backup and restore-tested additive migrations, deployment and separately admitted reader/executor capabilities. Threads API recovery defaults off. Real LinkedIn reader credentials/receipt issuer and a real preparation supervisor/authenticated pickup transport remain unregistered. Old frozen attempts are not automatically enrolled. Enabling a publisher, scheduler or consumer and sending a publication are not authorized by this local package approval.
