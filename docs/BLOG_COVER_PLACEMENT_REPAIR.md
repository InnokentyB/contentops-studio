# Site article-cover placement recovery

The canonical visual placement for a `site` article is `article_cover`, not
`feed` or the legacy art-direction label `blog`. Its asset contract is a
1200×630 cover/OG image with a 120px horizontal and 63px vertical safe area.
The article handoff is manual-only; placement repair never publishes.

An owner can use `ba_repair_publication_placement` when an accepted `site`
task still has top-level `feed`, while its completed art-direction work item
contains an active `GENERATE` decision for the same revision with
`channel=site` and `placement=blog`. Supply the current task/channel/revision,
the completed work-item ID, target channel ID equal to the existing site
channel, target placement `article_cover`, and a stable idempotency key.

Before applying, verify the accepted body checksum, schedule, absence of a
publication fact and selected asset, and the exact work-item/decision binding.
The repair creates a new revision-bound art-direction work item and resets
visual state to `PENDING_ASSESSMENT`; it does not edit the old decision, body,
schedule or publication fact. The art director must claim the new item and
submit a new decision before any image can be generated or attached. Visual
generation rejects a decision whose channel or placement differs from the
current task. A decision may identify the current channel by its account name,
numeric ID or legacy channel type; another account name is never equivalent.
