# Project 10 release recovery (10 October 2026)

These task-native controls are bounded recovery paths. None of the release,
preview, promotion, or connector-verification commands publishes externally or
creates a publication fact.

## Threads 1043

`ba_release_threads_task1043_api` verifies the current revision 4 / asset 128
package and the earlier approved revision 3 text-only evidence (approval 255,
art item 1438, decision 217). It materializes an audited current revision 5
`NO_VISUAL_NEEDED` binding with the exact historical body hash, leaving asset
128 immutable but no longer selected. Run `ba_publish_threads_task1043` with
`dryRun=true` and verify `has_image=false` before any separately authorized live
call.

## Dzen 1045

Run `ba_release_dzen_task1045`, then
`ba_verify_dzen_task1045_connector`, then the canonical
`ba_publish_publication_task` with `dryRun=true`. The release is fixed to channel
116, accepted revision 4, decision 267, asset 129 and the 10:00 UTC schedule.

## VK 1048

`ba_preview_vk_task1048_api_promotion` reports readiness for channel 117 without
revealing credentials. `ba_apply_vk_task1048_api_promotion` is allowed only when
the channel has a group ID, community wall-post token and classic user media
token. It cancels only unclaimed browser item 1699 and changes the exact task to
`connector_auto` / `ready_for_execution`; it never calls VK. If credentials are
missing, keep the task and browser item unchanged.

## Telegram 1096 lifecycle

Schedule-only rematerialization now preserves the lifecycle status of an exact
accepted, handoff-ready, visual-ready package when body, channel and explicitly
supplied brief are unchanged. If the legacy bug already left that exact package
in `drafted` or `revised`, the same materialization heals the derived status to
`approved`. Any body, channel or brief change still reopens the draft workflow.
This does not release or publish task 1096.
