# October 8 exact publication releases

These tools expose only the owner-approved packages #1077 and #1036 to Publisher.
Canonical services still require project owner identity, the current manifest,
accepted body hash, schedule, visual binding, no fact/link and no delivery attempt.
They do not send content. Generic owner-release tools remain hidden from Publisher.

## LinkedIn #1077

`ba_release_linkedin_task1077_browser` is pinned to p7/ch5/rev1, decision252,
NO_VISUAL_NEEDED and no asset. Owner reported manual publication on October 8:
**do not invoke release, queue or send for this task**. The owning Publisher must
first reconcile the exact existing provider object/permalink. Administrator role
or a missing Planner fact is not evidence of provider absence.

## Dzen #1036

The owning Publisher re-reads manifest/task/decision/asset and calls, in order:

1. `ba_release_dzen_task1036` with p10/task1036/ch116, revisions2,
   visual APPROVED/article_cover/decisionVersion1, asset122,
   body SHA `84f8f3ea79c4f252216e7568aa12a84eff08f685f33d4da360b94c8d8073e0fa`,
   asset SHA `8cbe7cecab92124712292d4d2b6723cee113d6dadec6d0a3ac6d952aeec925ba`,
   schedule/publish `2026-10-08T11:30:00.000Z`, current manifest checksum,
   owner actor, original owner GO reference and a stable release idempotency key.
2. `ba_verify_dzen_task1036_connector` with p10/task1036/owner actor and stable
   verification key. It probes the authenticated editor and records a 15-minute proof.
3. `ba_publish_publication_task` with p10/task1036/dryRun=true.
   Its payload title must be `65% решений автоматизировано. Почему этого мало для оценки системы`,
   the pinned first line of the accepted body, never `W41 allocation #16 — Dzen`.
4. Only the owning Publisher performs the separately authorized live call with
   dryRun=false and one stable send key. Unknown outcomes require reconciliation,
   never an alternative send key. Read back the confirmed provider identity/fact.

Any existing attempt blocks release; do not bypass this with raw database writes.
Refresh the MCP inventory; if the desktop inventory stays stale, fully quit and
reopen the app. Do not work around scoped tools with private API requests.

## Deployment / rollback

No schema/data migration, credential change or automatic publication occurs.
Rollback by reverting this release commit and redeploying both services. Existing
audit events and immutable art decisions must remain intact. Owner UAT is separate
from passing engineering tests.
