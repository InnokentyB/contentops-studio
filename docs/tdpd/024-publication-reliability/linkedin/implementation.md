# LinkedIn implementation and operating boundary

Owner approved the five reliability design packets on 2026-10-19 (direct reply: «Утверждаю пять пакетов»). This package implements the approved LinkedIn API readback slice; deployment and live admission remain outside this local change.

## Delivered boundaries

- `linkedin_recovery_reader.ts`: typed Posts API GET-only reader; application-owned resolver attests approved API route, exact account hash, supported read grants and an original-attempt-bound receipt. The receipt is not an RPC argument. Personal/company reads require their distinct scopes. The resolver must additionally establish the required company role and permission freshness before returning readAdmission; no real resolver/credential/receipt issuer is registered by this package.
- Known object lookup and independent verification each consume a durable request token. Provider author, object ID, body hash, publication state/time, visibility/feed and optional trusted upload/media mapping must match. No fuzzy body normalization. Unverified image hashes cannot confirm. Reshares, ads and unsupported content schemas stay held.
- Unknown-ID history may page only constructed `api.linkedin.com/rest/posts` URLs; complete history with a unique text match still cannot establish causal attribution. It never finalizes without a trusted original-attempt receipt. Pagination interruption/malformed pages remain incomplete.
- Responses are bounded to 1 MiB / 100 objects per page, redirects disabled, cancellation/deadline/request ceilings enforced. No raw provider error body is returned or logged.
- `browser_recovery_application.ts` connects this reader to the existing durable coordinator and a new provider-verified canonical finalizer. The actual `ba_mark_browser_submission_uncertain` registration now supplies that application operation. Its default has **no admitted readers**. Missing permissions or browser-only routes remain blocked; there is no API fallback, browser automation or provider permission change.
- `browser_recovery_verified_fact.ts` commits the original attempt, canonical fact, recovery state and audit in the existing guarded transaction. Evidence type is `api`; it does not invent screenshot evidence, browser observations or duplicate-absence claims. Approval/package/owner/deadline/abort rechecks preserve existing holds.

## Required before live admission

A supported application integration must provide a reviewed server-owned resolver to `createPublicationRecoveryApplication({linkedin:{resolve}})` and pass the resulting operation to `registerBrowserPublicationTools`. The current bootstrap uses the default unavailable operation. This is an explicit application integration seam, not a new user-callable registration tool or an environment flag that invents privileges.

A future resolver needs durable trusted receipt provenance and original scope; existing history-only browser publications do not have it. API grant/role proof must correspond to the already approved route. A browser-routed account remains blocked until an independently approved reader exists there. No historical frozen attempt is automatically backfilled or resumed. Live read-only smoke and owner UAT are outstanding.

## Container checks

Local reusable dependency image `planner-reliability-memory:20261019` must already be available; it contains the reviewed project's toolchain. `Dockerfile.check` copies current source and Prisma into it and runs backend compilation offline. No frontend source changed.

From repository root:

```sh
docker build --network none --memory 2g --cpu-period 100000 --cpu-quota 200000 -f docs/tdpd/024-publication-reliability/linkedin/Dockerfile.check -t planner-reliability-linkedin:20261019 .
docker compose -f docs/tdpd/024-publication-reliability/linkedin/compose.synthetic.yaml up -d synthetic-db
docker compose -f docs/tdpd/024-publication-reliability/linkedin/compose.synthetic.yaml run --rm check npm run migrate:deploy
docker compose -f docs/tdpd/024-publication-reliability/linkedin/compose.synthetic.yaml run --rm check
docker compose -f docs/tdpd/024-publication-reliability/linkedin/compose.synthetic.yaml ps
docker compose -f docs/tdpd/024-publication-reliability/linkedin/compose.synthetic.yaml logs --tail 50 synthetic-db
docker compose -f docs/tdpd/024-publication-reliability/linkedin/compose.synthetic.yaml down
```

The dedicated PG15 data lives in tmpfs; the stack has no host ports or persistent production volumes. Its explicit `10.231.86.0/28` subnet was checked against Tower networks after Docker's default address pool was exhausted. Do not reuse that subnet for a concurrently running stack. `down` here removes only this isolated stack; never use volume pruning or `down -v` as cleanup. Docker log rotation and CPU/memory/PID limits are declared in Compose.

For focused compiled tests, use the same check image with `docker run --rm --network none --user 1000:1000 --cpus 1 --memory 1g --pids-limit 128 planner-reliability-linkedin:20261019 node --test dist/tests/linkedin_recovery_reader.test.js dist/tests/linkedin_recovery_mcp.test.js dist/tests/browser_recovery_coordinator.test.js dist/tests/browser_actionable_diagnostics.test.js`. Run the repository quality gate in Docker with the exact source and required Git metadata mounted read-only; no baseline changes are part of this package.

Fresh verification: 46 compiled focused tests and 4 real PostgreSQL owning-operation/finalization tests passed; quality gate77/min77 and runtime7096/baseline7096 passed unchanged. The revocation case was first reproduced as RECOVERY_CONFLICT against image1 and corrected to APPROVAL_REVOKED. Late cancellation after beforeWrite rolled back attempt/fact/recovery together. Backend build2 passed; subsequent MCP description-only correction is noted for the final combined integration compile. See `trun.json` for every observed build/setup/test failure and `tests-output.txt`/`postgres-output.txt` for final results.
