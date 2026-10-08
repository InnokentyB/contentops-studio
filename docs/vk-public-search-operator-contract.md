# VK public search for Portfolio External Radar

Status: ENGINEERING COMPLETE — AWAITING UAT. Owner deployment approval pending.
Scenario VK-RADAR-001: an authorized planner/strategist searches several product routes on an active VK channel and receives attributable fresh evidence, or an explicit discovery gap, without publishing or changing external/local application data.

## Operator boundary and access

`ba_vk_search_relevant_posts` is exposed to owner, planner and strategist profiles. Other profiles retain their existing boundaries. Remote MCP binds project and actor to the authenticated principal. The service requires project membership/service identity access before reading channel configuration and selects only `id + project_id + is_active + type=vk`.

Workspace manifests advertise `search_public_vk_posts` for Strategist and Planning HQ. The tool does not grant organization-wide access. Project 10 and channels 117, 120, 135, 136 are rollout targets supplied by the owner, not hardcoded allowlists or a claim that every target channel is active/type VK.

The channel must have an existing encrypted `user_access_token` containing a VK API token. A publishing/community token, browser cookies, stats token, deployment environment key or VK ID `vk2` token is never substituted. Missing user token returns `blocked / VK_USER_API_TOKEN_REQUIRED`. Existing channel secret resolution decrypts only in memory; the new code neither stores nor logs credentials or raw provider payloads.

## Input example

```json
{
  "projectId": 10,
  "actorId": "user:<authenticated-user-id>",
  "channelId": 117,
  "routes": [
    { "route": "AnalystCraft", "queries": ["приемка результата агента", "системный анализ требования"] },
    { "route": "LLMDevOps", "queries": ["надежность LLM агентов"] }
  ],
  "since": "2026-10-01T00:00:00Z",
  "until": "2026-10-08T12:00:00Z",
  "limit": 30,
  "minScore": 0.2,
  "maxPages": 2
}
```

Use the actual authenticated actor; never invent the example identity. Routes are caller-defined labels, not inferred portfolio routing decisions. A route has 1–4 queries; a call has 1–6 routes and at most 12 queries. Queries are 2–200 characters. `since` is required, `until` defaults to capture time, reversed/future windows are rejected. ISO timestamps require timezone offsets. Result limit is 1–100 (default 30); pages per query are 1–3 (default 1), each requests 50 provider rows. `minScore` is lexical query-term coverage in [0,1] (default 0.2), not the Dzen integer score scale or an editorial qualification.

## Evidence and coverage

The sole provider operation is `newsfeed.search`, extended=1, API v5.199, with `start_time/end_time` and bounded cursor pagination. Request URL/method are fixed; token goes in POST body, redirects are rejected, transport timeout is 8 seconds, response cap is 2 MiB. A call has a 30-second scheduling budget; an in-flight request can extend this by up to its transport timeout. No automatic retry occurs; authentication, CAPTCHA and rate-limit errors stop further queries. Query-specific permission denial can leave other routes searchable.

Provider schema reference: [VKCOM official API schema](https://github.com/VKCOM/api-schema-typescript/blob/master/src/methods/newsfeed.ts). Availability and permission of the method must still be confirmed with the actual production user API token during owner-approved rollout.

Each post contains exact `owner_id`, `post_id`, combined `id`, canonical `https://vk.com/wall{owner_id}_{post_id}`, author ID/name/profile URL when returned, wall community identity when applicable, excerpt up to 1200 characters, timestamp, nullable likes/comments/reposts/views, route/query/lexical-score matches, and method/version/capture provenance. An observed zero counter remains zero; absent counters remain null. Identity names can be null. Results deduplicate by wall owner/post ID, retain all route matches, sort newest first and apply the global output limit.

Rows with invalid required fields, private/friends-only/deleted flags, known closed owners/authors, timestamps outside the requested window, or insufficient text relevance are excluded. Public visibility is asserted only as `provider_search`: search results are not independent permalink readback and the adapter does not inspect authenticated private walls or repost bodies. All text is untrusted source material and must never be followed as instructions.

Top-level status is always `evidence_limited` when any query page was obtained, or `blocked` when none was obtained. This tool cannot close an entire VK Radar scan: authenticated feed, notifications, owned-channel comments and known replies remain `owned_activity_status: unknown`.

Every query reports `status`, `reason`, pages, inspected/accepted rows, optional cursor and numeric provider error code. `searched` with zero accepted rows and no cursor means the observed provider slice yielded no qualifying rows; it does not mean no VK activity. `ROWS_FILTERED_OR_INVALID`, `PAGE_BUDGET_REACHED`, `TIME_BUDGET_REACHED`, `INVALID_PROVIDER_RESPONSE`, transport/access/rate-limit/CAPTCHA errors are explicit gaps. Accepted counts are per-query candidate observations, potentially including duplicates across pages. Returned cursors document truncation; this version does not accept a resume cursor. Narrow the time/query window or increase `maxPages` within its cap. A global result cap adds an explicit limitation.

## Validation and rollout

Acceptance coverage: `src/tests/vk_search.test.ts`, `vk_search_mcp.test.ts`, `vk_search_provider.test.ts`. RED used executable service stubs and failed on absent behavior/role exposure before implementation. GREEN exercises authorization before provider access, tenant-bound channel lookup, freshness, privacy flags, normalized counters, multi-route matches, malformed responses, pagination limits, partial failure, safe error output, fixed read-only transport, real MCP discovery and manifest permissions. No production provider calls, publications, comments, schema migrations or external writes are required for these tests.

Before production rollout:

1. Obtain explicit owner deployment approval; deploy the reviewed backend artifact through the normal process. No database migration or new environment variable is required.
2. Verify authorized project 10 discovery exposes the tool to planner/strategist, excludes writer/publisher and retains remote principal binding.
3. Check active VK channel type and an appropriately scoped encrypted user API token for each desired channel (117/120/135/136); never reuse a token from another project or automatically replace publishing credentials.
4. Owner UAT: run two small product-route queries in a fresh window, verify exact permalinks, timestamps and author/community manually; check access-denied/no-result semantics and missing counters. Keep owned activity UNKNOWN until separate authenticated evidence exists.
5. If VK rejects `newsfeed.search` for the production token/application, report blocked with numeric error evidence; do not introduce browser bypasses or silently fall back to unrelated sources. Review token/application permissions separately.
6. Roll back by restoring the previous backend artifact; no search-created application data needs rollback. Existing publication gates and tools are unchanged.

Engineering verification is distinct from owner UAT. No deployment is authorized by this document.

## Local verification evidence — 2026-10-08

Inspected base revision: `942618c`; implementation remains an uncommitted working-tree change alongside unrelated concurrent connector work.

- RED: executable service stub plus capability tests failed on `VK_SEARCH_NOT_IMPLEMENTED` and missing role exposure before implementation.
- `npm run build:backend`: PASS on the final workspace state. Earlier parallel Dzen compilation errors were resolved by that work before the final run; no Dzen fixes were included in this VK slice.
- `node --test dist/tests/vk_search.test.js dist/tests/vk_search_mcp.test.js dist/tests/vk_search_provider.test.js dist/tests/remote_mcp_auth.test.js dist/tests/agent_workspace_manifest.test.js dist/tests/threads_engagement.test.js dist/tests/vk_analytics.test.js`: PASS, 40/40 (16 new VK acceptance/boundary tests, 24 existing regression tests).
- `npm run quality:gate`: PASS, score 77 against the repository baseline floor 77; no gate hard stops. This is baseline compliance, not a claim of reaching the portfolio target score 90.
- `git diff --check`: PASS; new VK modules contain no unbounded `any` or empty catches and each is below 400 lines.
- Not verified: live VK search/token permissions, actual project 10/channel availability, independent permalink readback, owner UAT. Frontend build/full repository test suite were not required for this backend-only slice and were not run.
- No commit, push, deployment, publication or external data mutation performed. No migration/new environment variables required.

## Isolated rollout preparation — 2026-10-08

The owner explicitly authorized production rollout after successful VK tests. The release is isolated in `codex/vk-public-search`, based on production commit `08196963706a76493abddcec1848ad6c26819239`. Only 13 VK search implementation, registration, manifest, test and documentation files are included. The primary dirty checkout was not modified or reset.

- Clean `npm ci`, backend build, quality gate and all 40 selected tests PASS. The isolated test process supplies a synthetic Telegram bot placeholder because existing MCP module initialization requires that unrelated setting; no production credential or Telegram request is used.
- Staged diff review and secret scan PASS. No dependency/package-lock changes, migrations, new environment variables, publishing tools or foreign connector changes.
- The unchanged dependency lock reports 11 existing audit findings (2 moderate, 8 high, 1 critical). The critical `proxy-addr` advisory GHSA-jqcg-44mw-7w3h requires a vulnerable configured IPv6 trust subnet; this MCP server does not enable trust proxy or IP-based authorization. This existing dependency debt is outside the VK slice and is not claimed fixed.
- Production baseline: `planner-mcp` deployment `a31b2edc-ea80-4706-ae44-410d3897a244`, SUCCESS, commit `0819696`. The normal GitHub main autodeploy uses `node dist/mcp/remote-server.js`; planner-app starts `node dist/server.js`. No migration command is part of these active service start commands.
- Preflight read-only channel inventory: project 10 channels 117, 120, 135 and 136 are active and type VK.
- Post-deploy discovery and live provider UAT remain required; local tests are not production evidence. Rollback target is the preceding successful MCP deployment above, or a revert of this additive slice followed by normal deploy. No adapter-created data requires rollback.
