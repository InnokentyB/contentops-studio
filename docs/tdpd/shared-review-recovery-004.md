# Shared review recovery, package 004

Approved boundary: SHARED-PUBLICATION-DATA-BOUNDARY-004. This milestone removes
the unrelated manual-only channel restriction from existing owner-only review
collision recovery. It does not implement MP4 sending or finish Telegram video.

Operator tools remain `ba_get_content_review_repair_snapshot` and
`ba_repair_content_review_handoff` (preview default, explicit apply). The token
principal and owner membership still govern the action. The request binds body,
channel/config, revision, both dates, metadata and historical review/result.
Any fact/attempt, changed snapshot, accepted content, active lease or competing
review blocks it. Normal Editor and Art work remain required afterward.

Recovery requires a canonical placement and implemented non-generic materialization;
unsupported placement and the generic asset fallback reject with
`REVIEW_PLACEMENT_UNSUPPORTED`, including a configuration-only override without
an implemented contract. A nonblank stored placement and an implemented
format are required. Providers without editorial defaults may use an explicit
data-declared feed contract only when the existing adapter supports that
authoritative channel type. Configuration platform/capability flags cannot
register an executor, and the fallback cannot override established article-only
contracts. Existing manual-handoff providers use the adapter's server-derived
capability only with an actual manual-only contract; empty/automated/mixed modes
cannot invent direct execution. This is structural support, not live connector readiness. Arbitrary
configuration-only feed formats cannot gain configured execution metadata.
Recovery reports handoff mode/configuration, not a
fabricated manual-only route. A configured transport projection is not release
authority: content remains drafted, draft, unaccepted, visual STALE, no selected
asset and publication_mode approval_required. Existing approval/result payloads,
channel, body, dates and asset records are not rewritten; one replacement review
starts at result_version 0 for the same content revision.

RED: the additional Telegram configured-channel scenario failed with
`MANUAL_ONLY_CHANNEL_REQUIRED` in the existing compiled implementation on tower
Docker. Existing eleven review cases passed. GREEN: twelve review cases then
passed after removing that transport restriction and reporting the actual mode.
Real synthetic PostgreSQL covers audit rollback/concurrent apply/history and
gate preservation, alongside existing shared-browser scenarios. All application
execution is inside bounded containers; no provider or production mutation.

Rollback: reverting this metadata-only behavior before apply is ordinary. After
apply, preserve old and replacement reviews, approvals and audit; do not recreate
the collision or overwrite accepted content. Reverting code merely makes the
new configured-channel repair unavailable. There is no new send consumer,
credential, migration, scheduler or publication authority to activate.

Production first consumer: p10 task1103, revision2, old WI1756/result2. These are
operator data, not executable literals. On 2026-10-17 fresh readback still showed
draft/unaccepted/STALE/no selected asset/no publication fact. Its MP4 rebind and
MIME-aware MTProto transport are separate pending 004 milestones. This file is
not evidence that production recovery, Editor/Art acceptance or UAT happened.
The original new Telegram test incorrectly used unsupported video_cover and
expected automated metadata; late external review identified the invalid
assumption. It was corrected to canonical feed, with a separate RED negative
for video_cover and configuration-only overrides. Task1103 remains blocked
until its video placement and transport are implemented; do not disguise it
as feed to use this repair.

Compatibility correction: zen and the existing Habr/VC/OK aliases resolve to
their established formats and geometry without changing stored channel identity.
The article-specific zen_article alias remains article_cover-only, including
configuration overrides, matching its existing article-only dispatcher semantics.
Null/empty/whitespace placements reject rather than materialize a synthetic feed.
Known/system-declared format is not a live connector-readiness or provider check.
Article-only zen_article acceptance also validates its current placement before
writing acceptance or art work, including invalid old feed-only configurations;
it leaves the draft unchanged on failure. Other legacy acceptance semantics and
the established site default normalization are unchanged by this bounded fix.
