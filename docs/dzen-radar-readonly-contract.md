# Dzen External Radar: read-only coverage contract v1

Date: 2026-10-08. Operator: Portfolio External Radar through a project-bound Planner MCP token.
Engineering delivery requires owner UAT; deployment remains separately owner-authorized.

## Problem and evidence

The checked `external_radar` operating pack requires feed/search and known replies, or a specific access gap: UNKNOWN is not zero.
The owner reports 18 public result cards/snippets across five query clusters on 2026-10-08 for AnalystCraft project 10/channel 116. This is public discovery evidence only.
The live project-scoped manifest was read without identity overrides: project `analystcraft-2`, Dzen channel 116, revision `2026-10-07T13:12:09.484Z`, checksum `sha256:e7f837d363d88c6a30c5e5daac002894f85ccd7e73249fa45ef07d7efc27e46f`. The matching Planning HQ bootstrap was also read. The exposed production connector inventory contains Dzen search, metrics and outbound comment tools, but no owned activity/replies reader. New behavior below is local source, not deployed production evidence.

Local inspection at base revision `942618c` plus pre-existing working changes:

| Surface | Available mechanism | What it establishes |
| --- | --- | --- |
| Public discovery | `searchDzenPosts` in `puppeteer_publisher.service.ts` | Bounded public title/snippet cards through the configured browser session; no publication dates or article bodies |
| Studio publication inventory | `readStudioPublications` in `dzen.service.ts` | Existing authenticated incident-reconciliation reader; not MCP Activity or comment coverage |
| Publication metrics | `collectPostMetrics` | Individual counters; comment count cannot establish read replies |
| Outbound comments | `comment` / `preflightComment` | Send/preview workflow; not an inbound reader |
| Owned channel, comment bodies, replies, Activity | No MCP reader | UNKNOWN, with null counts |

This is an adapter capability gap, not proof that Dzen forbids these reads. No undocumented API, alternate identity, CAPTCHA bypass or permission escalation was introduced. No live owned-surface scan was performed. The authorized Studio inventory may support a later read-only slice, but cannot prove inbound reply coverage by itself.

## Operator boundary and response

`ba_dzen_get_radar_coverage({channelId: 116})` is available to planner, strategist and owner. Remote MCP supplies actor/project from the token, validates scope and calls the existing project membership + active project-owned Dzen channel lookup. The diagnostic never contacts the provider or changes stored data.

It returns `schema_version=1`, `complete=false`, `provenance.source=adapter_contract`, `contract_version=dzen_radar_v1`, `provider_requested=false`, and separate surfaces. Owned channel, comments, replies and Activity each return `status=unknown`, `count=null`, `reason.code=reader_not_implemented`, source file/method evidence and a native read-only follow-up. Public discovery starts as `not_scanned`; only an actual successful search response observes its bounded cards. Saved credentials do not imply a valid session or verified channel authorship.

Search keeps its `query`, `posts`, `count`, `source` success fields and existing relevance ordering/filter/limit. It adds:

- `status=observed` for successful reads; `count` means **returned relevance-filtered cards**, never total platform results or owned activity. An empty filtered set establishes no qualifying returned cards only.
- Search URL, capture timestamp, requested limit and minimum score as provenance; timestamps identify collection, not publication. Coverage remains `complete=false` even after a successful search.
- Per-card `evidence_ref`, `article_body_read=false`, version `dzen_card_screen_v1` and `freshness.status=unknown` / `published_at=null` / `publication_date_not_extracted`. Relative dates or years embedded in snippets are not trusted dates.
- Transparent title/snippet flags: `promotional_language`, `seo_listicle_language`, `limited_snippet` (under 40 characters). These are conservative heuristics with false positives/negatives. All cards remain `review_required`; absence of flags is not editorial acceptance, and flagged cards are not silently dropped. Read the native body/date before calling a hit fresh, useful or action-ready.

On browser/provider failure search returns `status=unknown`, `count=null`, `posts=[]`, typed `error` and coverage. Consumers must check status/count and must not turn `posts.length=0` into “no activity.” Authorization, missing/foreign/inactive channels and wrong channel types still throw before provider execution. This intentional read-error response change replaces generic provider exceptions; clients relying on exceptions need updating before rollout.

## Error taxonomy

| Code | Retryable | Meaning / operator action |
| --- | --- | --- |
| `reader_not_implemented` | No | Missing coverage reader; keep UNKNOWN and obtain authorized native evidence |
| `not_scanned` | No | Capability diagnostic did not execute discovery |
| `auth_required` | No | Restore owner-authorized saved session |
| `interactive_verification_required` | No | Owner completes native verification; never bypass |
| `interface_changed` | No | Missing search markup; inspect the interface, not a zero-result verdict |
| `timeout` | Yes | Retry read later; leave UNKNOWN |
| `session_busy` | Yes | Wait for scoped browser lease release |
| `unsafe_profile` | No | Repair trusted browser scope/profile configuration |
| `provider_failure` | No | Unclassified failure; inspect sanitized diagnostics before retry |

Error responses allowlist code, retryability and guidance only. They do not return raw error messages, stacks, provider payloads, cookies, headers or profile paths. The existing browser cleanup/session isolation remains in place. This slice adds no configuration, migration, data persistence or external mutation.

## Acceptance scenarios and verification

`src/tests/dzen_radar.test.ts` covers operator-facing UNKNOWN/null diagnostics; source evidence; membership denial before channel lookup; active project/channel scope; successful discovery with separate owned gaps; failing search with null count and sanitized errors; relevance versus freshness/quality; role permission; MCP schema/annotations; and token-bound actor/project.
Tests were authored before implementation: the initial run failed because the new radar module did not exist. This is feature-absence RED evidence, not a live production/UAT test. Focused and related compiled test results are recorded in [the delivery evidence](evidence/dzen-radar-2026-10-08.md).

Required local gates: `npm run build:backend`, `npm run quality:gate`, and focused Dzen/MCP/manifest tests. The repository quality baseline remains 77; passing its gate does not establish the portfolio target of 90.

## Owner rollout and UAT

1. Review this local diff separately from concurrent/pre-existing connector changes. No commit, push or deployment is implied by engineering verification.
2. Explicitly authorize deployment of the reviewed revision. No migration or config change is needed. Refresh the project-scoped MCP connector capability inventory after release.
3. With the project-10 Planner token, call coverage for channel 116: verify UNKNOWN/null on all owned surfaces, source evidence and `provider_requested=false`.
4. Run the five known query clusters: verify card provenance, UNKNOWN freshness, visible promo/SEO flags, and that zero filtered cards is not reported as zero activity. Independently inspect sample native bodies/dates for heuristic false positives and negatives.
5. Test expired session, verification challenge and absent markup in a controlled environment. Confirm failures produce UNKNOWN/null without secret-bearing provider text. Check another project/channel is denied and no publication, comment, read-state marker or approval state changes occur.
6. Owner records explicit UAT verdict. Until then: ENGINEERING COMPLETE — AWAITING UAT, only if all engineering gates pass. Keep Dzen daily owned coverage incomplete until native evidence or a separately tested inbound reader exists.

Rollback: revert only this slice's radar module/test, Dzen search response additions, tool registration/allowlist and Dzen startup instructions; preserve other working changes. Restore previous exception handling for search if rolling back. No data rollback is needed.
