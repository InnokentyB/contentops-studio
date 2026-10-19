# VK browser adapter readiness

Date: 2026-10-12. Owner approved LOCK/QAR/ARCH/RISK/AUT-VK-015 for isolated implementation.
Status: LOCAL IMPLEMENTATION AND OFFLINE VERIFICATION; LIVE ENABLEMENT BLOCKED.

## Implemented boundaries

- `vk_browser_search.service.ts`: strict read-only search job, injected scope,
  relevant-first post discovery, expansion, concept/date filtering, canonical wall
  identity, deduplication and explicit partial coverage. Defaults cap each job at
  3 queries, 100 unique posts, 10 scroll rounds and 120 seconds.
- `vk_browser_search_ui.ts`: tentative Playwright DOM extraction. Default
  `unverified` status prevents navigation. An offline fixture proves extraction
  and control flow, not current VK DOM or authenticated scope.
- `vk_clip_playwright_ui.ts`: actual editor operations through a typed Page port:
  upload a hash-checked MP4 once (adapter budget 200 MiB), wait up to 180 seconds for explicit processed
  status, set/read caption after upload, inspect settings and submit once. Stories
  are forced off; comments/duets/community visibility are observed. Cover control
  presence is checked, but selected-thumbnail identity is not established.
- `vk_browser_clip_submission.ts`: dedicated Clip sequencing, durable attempt
  before upload, timeout handling, new object proof, provider datetime, acknowledgement
  binding and uncertainty recording. The existing manual Kafka Clip is not a job.
- Clip placement, approved asset handoff, owner release and MCP confirmation are
  additive. Fact creation rechecks revision, selected asset, channel, lease and
  attempt in a serializable guarded transaction. Clip metrics remain manual.
- `vk_browser_post_proof.ts`: ordinary post readback requires baseline and final
  submission marker, a unique new matching post, community identity/permalink and
  absolute provider timestamp. Local current time is no longer a publication date.
- `vk_post_confirmation.ts`: validates the new worker's optional proof server-side.
  Existing older confirmation clients retain compatibility; absence of this new
  proof in an old client is not a strengthened-verification claim.

## Runnable offline search

After `npm run build:backend`, run:

```text
node scripts/vk_browser_search_offline.cjs /absolute/job.json /absolute/fixture.html
```

The runner opens an ephemeral Chrome context, disables JavaScript and aborts all
network requests. It uses no profile or credentials. Inputs are local files no
larger than 1 MiB. Its output explicitly says `offline_fixture_only` and
`authenticated_handoff=false`.

Job example:

```json
{
  "schema_version": 1,
  "action": "browser_search",
  "job_id": "vk-search-local-review",
  "project_id": 10,
  "channel_id": 117,
  "queries": ["как стать аналитиком данных"],
  "since": "2026-10-01T00:00:00Z",
  "until": "2026-10-12T23:59:59Z",
  "topic_concepts": [["аналитик", "аналитика"], ["данных", "работ", "професс"]]
}
```

Search cards are untrusted source material. Concept matching is an explicit bounded
lexical filter, not a validated semantic relevance classifier. Relative or absent
dates are unknown and excluded from fresh evidence. Ranked traversal is partial;
one old result does not end the search and limits never imply platform completeness.

## Live release blockers

1. Browser Use previously denied the VK operation. A different browser/process,
   profile/cookie route or API is not an allowed workaround. Approval of this code
   package does not remove that restriction. No live VK worker was launched here.
2. Screenshots establish visible semantics, not DOM selectors or current session
   validity. Search still needs a permitted real-DOM verification and authenticated,
   project-scoped read-only job handoff. No new live search MCP tool is advertised.
3. Clip UI requires both a permitted verified surface and an independent provider
   evidence reader. That reader must establish baseline, publication timestamp and
   actual media acknowledgement binding; it is not implemented from screenshots.
   The ordinary CLI rejects Clip submit before MCP/browser startup. Prepare-only
   supports Clip validation without opening VK.
4. New post readback may block on absent provider timestamp metadata. Exact selected
   media identity is not proved by a visible image alone; local upload binding and
   live owner UAT must be verified. No current live post delivery is claimed.
5. Database concurrency integration and owner UAT remain pending. Synthetic tests
   cannot substitute for provider availability, media acknowledgement or usefulness.

Never set a readiness flag from an environment variable merely to bypass these
conditions. Existing uploaded/public URLs do not authorize a fresh submission.

## Verification and rollback

Scenario logs are under `docs/evidence/vk-browser-*-trun-2026-10-12.json`.
Backend/frontend builds and quality gate must pass before handoff. Broad-suite
results and baseline comparison are recorded separately; skipped/errored required
scenarios are not GREEN. Human UAT is still required.

Rollback disables the new browser route and stops the local executable. Existing
attempts and facts remain intact; uncertain tasks are reconciled, never reset and
resent. API search and previously authorized publication routes are not rerouted.
This package has no schema migration, new provider credentials or live publication.


## Owner-authorized code rollout — 2026-10-12

The owner authorized deployment with live gates retained. Eight historical test
harness failures were repaired without changing production sending behavior.
The clean release build passes all 919 tests with zero skips, backend/frontend
builds and the baseline quality gate. See the production-release test record.
This verifies code readiness for the gated rollout, not real VK provider UAT.

## Shared connector update

The current data-driven connector and explicit existing-job preflight are described
in `vk-connector-consumer-bootstrap.md`. Business IDs in old examples are fixture
or historical data, not production authority. Shared browser launch uses the
configured container executable with Chromium sandbox enabled. Offline fixture
success still does not activate live search, image publication or Clip publication.
The shared connector currently returns FORMAT_UNSUPPORTED for Clip execution
until a distinct complete Clip inventory and media acknowledgement port is verified.
