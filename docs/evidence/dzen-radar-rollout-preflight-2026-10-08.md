# Owner-authorized Dzen Radar rollout preflight

The owner authorized production rollout and checks on 2026-10-08: «давай все в прод и проверять». This authorization covers deploying the reviewed Radar slice and read-only live checks; it does not authorize publishing comments/posts or marking external read-state.

Release parent: `b3b31e5b4499247884b7f9c4dfea1a83c13032b8` (current main). VK search from `3deaf94` and owner publication retirement from PR #55 are preserved. Dzen radar changes are isolated from the original workspace's incomplete LinkedIn, Threads, Telegram, VK-format and persistent Dzen-browser work. No migrations/configuration changes are included.

## Local release verification

- `npm run build:backend`: PASS in the isolated release checkout.
- `npm run quality:gate`: PASS, 77 baseline, no reported hard stops.
- Dzen, VK search, remote MCP auth, workspace manifest and organization researcher tests: **87/87 PASS**, zero skipped, sequential compiled tests using synthetic local Telegram/JWT values, no production database credentials.
- Full compiled backend test suite with synthetic local environment: **610/617 PASS**, seven failures in unchanged `prepare_approval_guard` and `telegram_direct_payload` fixtures which make unmocked database calls. All seven were reproduced by running those files against a separate, unmodified archive of parent main: 3/10 pass, same seven failures and missing local database. No new failures; the affected Radar tests and auth/tenancy tests pass. This is not a claim of a green full suite.
- `git diff --check`: PASS. No tokens/cookies/profile data/logs enter the release.

## Production baseline and rollback

Before rollout the real project-10 Planner credential confirmed `ba_vk_search_relevant_posts` available, `ba_dzen_get_radar_coverage` absent, both MCP `/health` and app `/api/health` HTTP 200. The baseline manifest checksum was `sha256:1991ca35ca3a6f7193d73af1e815b694d84e32a080b0451d6f95a5c618382649`.

Railway production project `94bdd09f-d4c1-46fd-aa9f-7eec583992c1`, environment `c8a07407-dbfa-4dc2-a09e-5cbacce7ebea`. Baseline MCP deployment `3a36bcf7-50fd-4a61-b454-2e881f2638f0` at parent `b3b31e5`. App was completing deployment `6ad5824d-8177-408a-ab03-8477fef1f6cb` at the same parent, with previous successful `3d41fb30-cbc1-4add-a075-ebf49c955d51` at VK commit `3deaf94`.

Deploy through the normal main-branch GitHub/Railway path. Verify both services' SUCCESS deployment revision and health; perform read-only scoped tool discovery, diagnostic UNKNOWN/null, foreign-project/wrong-channel rejection, bounded Dzen public search, bounded VK search, strategist read-only exposure and writer exclusion. Capture safe provider taxonomy separately from rollout success. No blind provider retries or expired-token tests using credential rotation.

Rollback if this slice regresses health/auth/read behavior: restore the recorded previous service deployment or revert the isolated Dzen Radar commit through the normal main-branch path. No data rollback is required. Do not roll back unrelated concurrent releases without inspecting their exact revision.

The reader remains diagnostic: owned comments/replies/Activity and authoritative search publication dates are not implemented and remain UNKNOWN. Production smoke is engineering verification; owner acceptance remains explicit.
