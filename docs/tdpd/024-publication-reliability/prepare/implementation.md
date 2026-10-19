# Preparation recovery implementation / admission boundary

The owner approved the five LOCK/QAR/ARCH/RISK packets on 2026-10-19: «Утверждаю пять пакетов». Source baseline 3fd625a. This is a reusable controlled-executor component, tested with a deterministic synthetic supervisor. **No real supervisor, authenticated pickup transport, queue consumer or browser executor is registered or activated.** A function seam is not proof that a real browser can be stopped/fenced. Production and frozen attempts are unchanged.

## Actual delivered behavior

1. An application-registered supervisor can admit the original start into PREPARE/NOT_DISPATCHED in the same transaction that creates its original attempt. Ordinary default starts create no technical records and retain existing behavior. Unsupported X native/Dzen/VK execution cannot be manufactured by this component.
2. Protected `BrowserPreparationExecution` storage owns executor hash, generation/revision, quiescence challenge/proof hashes, durable recovery counters/deadline and pending/claimed pickup. It is a dedicated tenant/attempt-FK table; project settings and import/export are not technical authority. A generic settings overwrite cannot fake this ledger. No raw lease, approval or provider payload is stored in it.
3. Recovery first closes that generation's preparation admission durably, then asks its registered supervisor for a matching technical cancellation/failure acknowledgement outside the database transaction. The maximum wait is 10 seconds. The acknowledgement must prove a recognized transient preparation failure, exact generation/challenge and old-executor quiescence. Timeout/unknown proof remains held; missing events or lease expiry are never enough.
4. Existing serializable resume checks revalidate owner, exact approval/package, pending original attempt and challenges/zero permits. One CAS rotates the private work lease, increments generation, supersedes safe preparation challenges and writes the pending pickup atomically. Lease expiry is clipped to the original preparation deadline. Original error and publication key are retained. A restarted component can claim the same queued pickup without creating another attempt or generation.
5. Preparation budget: 3 resumptions within 180 seconds; subsequent resumption admission cannot precede offsets 30/120 seconds. Restarts, new technical recovery keys and replay cannot reset it. Technical recovery keys are distinct from the unchanged publication key and convey no send authority.
6. A private application pickup returns the current lease only to the registered executor integration; there is no general MCP/status endpoint returning it. Existing MCP uncertainty/start registrations compose the preparation service; default service has no supervisor. The actual owning MCP handler returns a safe actionable recovery status, never the private lease or supervisor proof.
7. Only a transaction-local **first_permit** purpose with exact attempt and generation can enter the existing pre-submit release check. Generic writers, claim/release/uncertainty and the canonical fact guard remain held even inside that transaction. This is not a broad guard bypass. The normal exact observations, owner/package/lease and one-permit checks remain; old attempt errors are not cleared to obtain a permit.
8. Registered dispatch consumes the same generation/first permit once before invoking its approved sender callback. Old generations, reused/expired permits and failed/uncertain sends cannot dispatch again. Raw sender exceptions are replaced by safe POST_SUBMIT_UNKNOWN guidance; the durable dispatch-started phase already preserves possible delivery.
9. Results use the existing canonical guarded finalizer, retaining its observation/approval/idempotency requirements. `withBrowserRecoveryFinalization` now completes any admitted preparation ledger in that same transaction, after the original checks and before commit. This shared hook covers ordinary browser readback and the separate LinkedIn API finalizer. It grants no new fact authority. A failed ledger completion rolls back fact, attempt and recovery too.
10. Transition into readback occurs only once. Repeated uncertainty while a read is active leaves its lease, deadline, counters and row version untouched. Preparation and readback budgets are distinct. Discovery of an absent new table permits old, non-preparation recovery; it never admits a missing preparation executor.

## Writer inventory / constraints

- `browser_publication_execution`: original start admission; pre-submit explicit narrow purpose; optional registered preparation operation before generic uncertainty freeze. Existing default calls preserve their guards.
- `browser_publication_guard.checkedBrowserRelease`: default v2 hold retained; explicit first-permit purpose cannot authorize another writer.
- `browser_recovery_guard`: private scoped capability, finalization commit guard and shared preparation completion; no caller flag or RPC registration.
- `browser_recovery_resume_repository`: durable proof lookup, challenge checks and atomic pending-pickup hook in the same existing serializable transaction.
- `publication_fact.service` / `browser_recovery_fact_transaction`: existing canonical fact/commit fence retained. Private preparation admission does not grant generic fact writes.
- Native X controls continue to use their existing native receipt/lease route and cannot acquire the new purpose through an ordinary tool. No X supervisor is implemented here. Dzen/VK stay on their mandatory independent adapter route; this browser contract does not include them.
- Historical task-specific helpers are not migrated or registered as supervisors. This package does not certify every historical path as a controlled dispatch boundary. Before any live route admission, its actual executor and every applicable sender/control path must pass the approved fencing audit; otherwise admission remains unavailable. Old/frozen attempts are never enrolled by inference.

## Integration

`createPreparationRecovery({deps,supervisor})` is an application-only composition point. A real integration must authenticate its executor before invoking private pickup/permit/dispatch/result methods and prove exclusive dispatch ownership, including old/offline workers. Merely returning `oldExecutorQuiescent:true` is insufficient operational evidence. No production resolver/supervisor or permission setting is supplied by this change.

When combined with LinkedIn, preserve `registerBrowserPublicationTools(server, recovery=createPublicationRecoveryApplication(), preparation=createPreparationRecovery())`; uncertainty passes both `recovery` and `input=>preparation.operation(input,recovery)`. The separate worktree's second argument is optional because its baseline does not yet contain LinkedIn's application factory. The integration must retain LinkedIn's default factory and both dependency-injection positions.

Additive migration: `20261019150000_browser_preparation_execution`. It creates protected technical storage only; it populates no historical records and activates no consumer. A production rollout still requires reviewed backup/restore/migration evidence and explicit release approval. Rollback disables new admission/pickup while preserving technical rows, leases, generations and holds; never re-enable an old generation or use an older sender to bypass these rows.

## Docker-only checks

Use `Dockerfile.check` with repository-root context and retained local toolchain image `planner-reliability-memory:20261019`. Relevant build is backend/Prisma; no frontend files changed. The standalone synthetic Compose uses a dedicated PG15 tmpfs database, internal subnet 10.231.87.0/28, no host ports and CPU/memory/PID/log bounds.

```sh
docker build --network none --memory 2g --cpu-period 100000 --cpu-quota 200000 -f docs/tdpd/024-publication-reliability/prepare/Dockerfile.check -t planner-reliability-prepare:20261019 .
docker compose -f docs/tdpd/024-publication-reliability/prepare/compose.synthetic.yaml up -d synthetic-db
docker compose -f docs/tdpd/024-publication-reliability/prepare/compose.synthetic.yaml run --rm check npm run migrate:deploy
docker compose -f docs/tdpd/024-publication-reliability/prepare/compose.synthetic.yaml run --rm check
docker compose -f docs/tdpd/024-publication-reliability/prepare/compose.synthetic.yaml ps
docker compose -f docs/tdpd/024-publication-reliability/prepare/compose.synthetic.yaml logs --tail 50 synthetic-db
docker compose -f docs/tdpd/024-publication-reliability/prepare/compose.synthetic.yaml down
```

Do not use `down -v` or prune unrelated volumes/networks. Focused compiled tests: `node --test dist/tests/browser_preparation_recovery.test.js dist/tests/browser_recovery_resume.test.js dist/tests/browser_recovery_resume_repository.test.js dist/tests/browser_actionable_diagnostics.test.js` inside the same container image without network. Run `npm run quality:gate` in Docker with exact current source and Git metadata mounted read-only. TRUN records source/build/test identities and every observed failure.

Owner UAT remains pending, and live automatic resumption remains unavailable until a real approved supervisor/adapter proves the technical fence. Engineering tests do not authorize production migration/deploy/publication or resumption of historical attempts.

## Verification snapshot and remaining integration checks

Standalone reviewed build 62762d6804a3 passed backend/Prisma compilation. Its 23 PostgreSQL acceptance cases and 38 compiled focused cases passed. Final source adds a truthful static PREPARATION_RECOVERY_FAILED classification for an unclassified dependency exception (rather than inventing a concurrency cause); 58 source tests, including nearby coordinator regressions, passed after that last edit. The exact combined release must compile that final source and run `tests/tdpd/linkedin-preparation-integration.test.cjs` (two API-reader/preparation atomicity cases). This cross-package file is intentionally not counted as a standalone pass; it requires the LinkedIn application package. Final quality gate preserves 77/min77 and 7096/baseline7096, without exceptions or baseline changes. See TRUN for all observed failures, including the corrected synthetic observation-time fixture issue.

The existing 20 PostgreSQL recovery regressions also passed after supplying their required NODE_PATH and read-only /workspace source alias. These two setup failures are recorded separately from product failures in TRUN.
