# Telegram task 1099 personal Story recovery

Task 1099 is a bounded recovery for initiative 296. The immutable package is
accepted caption revision 1, decision 277/v1, approved asset 134 and source media
SHA-256 `ab299952f375cef3346c9a43dc529db1a74ac281dc16f290ab8de0b6cb796c6c`.
The rejected render job `6474ed84-5a6a-494d-a06c-7183e9ace9bb` remains forbidden.

The governed sequence has three separate operations:

1. `ba_repair_telegram_task1099_story_placement` changes only the task subtype
   and placement from the legacy `publication/feed` projection to
   `telegram_story/story`, then rebuilds derived routing metadata. Caption,
   revisions, decision, asset, channel 108 and schedule remain unchanged.
2. `ba_release_telegram_task1099_personal_story` performs an owner-only audited
   release after verifying the exact package, source task 1098/fact 442, the sole
   active MTProto account 2 and the confirmed personal Story precedent
   task 986/fact 363. It never sends.
3. `ba_publish_telegram_task1099_personal_story` provides dry-run inspection and
   a separate explicit one-shot personal-profile MTProto Story send. The route
   accepts the approved MP4 as a streaming Telegram document. There is no
   channel/feed fallback. A provider uncertainty freezes retry and records no
   publication fact.

Deploying the tools performs none of these task mutations and does not publish.
