# Setka task 1047 browser recovery

Task 1047 is an exact, owner-authorized recovery for project 10/channel 126.
The accepted package is revision 4, decision 269, approved asset 131 and the
original `2026-10-10T14:00:00.000Z` slot. The canonical owned Setka identity is
`https://setka.ru/users/019c99e2-fb9d-78e0-9876-9c4a360bb4dc`.

The governed sequence is deliberately split:

1. `ba_release_setka_task1047_browser` verifies every package hash, the old
   manifest, owner membership, the absence of facts/attempts/work and the
   durable R2 asset. In one transaction it binds the profile to channel 126,
   enables only manual/browser handoff, changes the task to `browser_required`
   and creates one browser work item. It never opens Setka.
2. `ba_claim_setka_task1047_browser_publication` leases that exact work item.
3. `ba_start_setka_task1047_browser_submission` creates the one durable attempt
   immediately before a human or local browser worker submits the post.
4. A confirmed `https://setka.ru/posts/<id>` readback plus screenshot evidence
   is required by `ba_confirm_setka_task1047_browser_submission` before any
   publication fact is recorded. Ambiguity must use
   `ba_mark_setka_task1047_browser_submission_uncertain`, which freezes retry
   and records no fact.

There is no Setka API connector and no automatic/browser action in these MCP
tools. Deploying them does not mutate task 1047 or publish anything.
