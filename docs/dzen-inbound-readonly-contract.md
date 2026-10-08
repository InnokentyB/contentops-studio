# Dzen inbound reader v1 — 2026-10-08

## Operator boundary

External Radar/planner/strategist needs native comment bodies, parent-linked replies and Activity evidence to decide which conversations deserve review. Active project membership and the active Dzen channel are checked before provider access. Remote actor/project identity remains token-bound. Owner can inspect; writer/publisher/organization researcher cannot call these readers.

`ba_dzen_read_inbound` validates the configured Studio publisher and read access, then reads the native Studio comment list and account notifications. `knownThreadUrls` scopes external-comment notifications to at most ten explicitly requested public publications. Notifications for unrelated publishers are omitted and counted; their absence is never a no-activity verdict. Default one page; maximum three pages, 40 Studio rows and 25 notifications per page. Up to three incomplete Studio child threads are loaded, at most 40 rows per thread. Counts mean returned rows. Empty validated native payloads may produce observed zero; missing/malformed/auth failures remain UNKNOWN/null.

`ba_dzen_read_thread` reads an exact canonical public publication's root-comment response and up to three child lists by default (maximum five, or zero for root-only inspection). It preserves provider timestamps, author names, connected-owner identity, root/direct-reply IDs and canonical links. Native `/a/` and `/b/` permalinks encode the publication ID; response capture starts before navigation and matches that exact native document and the main frame, including comments prefetched on short articles. Legacy `/media/` article forms are not converted by this reader and remain an explicit interface gap. Root and child native totals are separate from loaded rows. Incomplete roots/children remain explicit; this is not an unlimited historical scan. Provider pagination for additional public root/child pages is not automated in v1.

## Read-only invariants

All browser traffic is HTTPS to the Dzen/static provider allowlist. POST/PUT/PATCH/DELETE and native GET mutation paths are blocked, including `/api/bell/notifications/seen-until`. Public comment GET requests force `updateDefaultSorting=false`. Native CSRF/fingerprint headers are captured only from the authenticated, exact-channel Studio request, retained in page-local memory, forwarded only to fixed same-origin read endpoints and discarded in finally. Cookies, headers, CSRF tokens and raw provider payloads are never returned, stored or logged. Each call uses an isolated browser closed in finally, including page-creation failures.

Account notifications are checked against Studio owner identity. Studio comment publisher and public comment document/root identities must match the requested surface. Private browser state is not exported. No posts/comments/reactions/subscriptions, read-state writes, metric snapshots or publication records are created by these tools.

## Evidence baseline

Observed authorized production UI and public frontend contracts on 2026-10-08:

- Studio publisher identity `/editor-api/v3/publishers/{id}` and its `accessData.canRead`.
- `/editor-api/v2/social/editor/comments/latest_by_child`, `publisherId`, `limit`, `commentIdAfter`; cursor follows the native last root ID. Native Studio schema preserves `rootId` and `replyToId`.
- `/editor-api/v2/social/editor/comments/children`, root/publisher scope, `sort=time-desc`.
- `/api/bell/notifications`, `take`, `skip`; `/count` before/after. Reaction actor `action` is a structured provider object and is deliberately excluded from outputs; native notification type is retained.
- `/api/comments/v2/root-comments`, `entity=comment`, native meta/counters, optional inline subthreads.
- Public comments frontend v1.46.2 declares `/api/comments/v2/child-comments`, `rootCommentId`, `documentId`, `publicationPublisherId` and root/direct-reply fields. No guessed private endpoint or challenge bypass.

## Acceptance and rollback

RED: operator scenario failed because both native reader tools were absent. Functional tests cover actual bodies/reply IDs, bounded native scan, native zero versus missing payload, notification scoping/recipient mismatch, secret exclusion, mutation blocking, authorization before provider access and cleanup on page-creation failure. Backend build, related role/auth/provider tests and quality gate are required. Production verification and independent Radar review must follow deployment. A live nonzero child-reply fixture may be unavailable; synthetic contract tests do not replace that limitation.

No database/schema/environment changes. Rollback is revert of the reader release commit and normal redeploy; prior search, outbound approval/idempotency and local diagnostics remain compatible. Human owner UAT remains separate: engineering completion is not acceptance. Exact outbound text/publication approval is still required by the External Radar operating contract.
