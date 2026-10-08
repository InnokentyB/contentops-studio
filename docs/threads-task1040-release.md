# Threads1040 exact release and near-now schedule

Tool: `ba_release_approved_threads_task1040`, publisher MCP, authenticated project10 owner.

Pinned package: channel138/innokenty_threads, content=accepted revision4,
body SHA-256 `6c7e36761a0f7cf48859f8f9ef673f3aa38105fa61c10d4ea592cbbeddc60353`,
completed review1623/result4/input4, completed art1624/input4,
active decision256/version2/threads/feed/NO_VISUAL_NEEDED, no selected asset.

Arguments: `projectId:10`, `taskId:1040`, token-bound `actorId`, current
`expectedManifestChecksum`, owner `approvalReference`, stable `idempotencyKey`,
and `newScheduleAt` in ISO UTC, between two minutes ago and ten minutes ahead.
Choose now plus one or two minutes immediately before invoking. Replays must use
the identical arguments and key, including the original newScheduleAt.

The command checks provider identity and a complete bounded own-post history;
public keyword search is not duplicate proof. It rejects any existing delivery
attempt, uncertain result, fact, public link, active browser item, stale package
or manifest. A serializable transaction changes only schedule_at/publish_at from
2026-10-08T16:30Z and publication release state, recording old/new times and hashes.
It never sends or creates a publication fact.

Separate send: `ba_publish_publication_task` with project10/task1040,
`dryRun:true` first; then an explicit owner-authorized live call with a single stable
send idempotency key. The existing task-native Threads transport validates the
release proof, revision/hash/decision and both current timestamps. No photo/browser
fallback. Uncertain provider result remains frozen and cannot be blindly retried.

Rollback: revert the new tool/allowlist/spec and exact1040 branches. Preserve audit
events; a released task requires audited hold before disabling its route. No schema
migration or rewrite of accepted body, approvals or art decisions is involved.

Engineering tests use fake provider ports. Real duplicate history and provider
publication identity require production UAT in the owning publisher chat.
