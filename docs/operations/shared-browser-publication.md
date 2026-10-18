# Shared browser publication controls

Consumers: LinkedIn image or canonical text-only posts, personal Setka image posts
and DEV.to articles with approved covers. Telegram video/review repair remains a separate pending
004 milestone. See [Setka handoff](./shared-setka-browser-publication.md).
These commands control Planner state only. They do not open a browser, import a
session, click Submit, or independently verify a provider. Existing site/tool
denials remain. Use the single owning Publisher in its already-authorized
context; no new executor, credentials, account or browser rights.

## Exact current package as data

Read the owning task, current manifest, Registry and durable asset before apply.
For the first urgent consumer, readback on 2026-10-17 confirmed project7/task1136,
accepted revision5, decision327/version4, asset166, unchanged dates and no fact.
Registry v36 local immutable read (no WAL present) maps
`profile_seturon_linkedin_page` → Seturon company97416172 → project7/channel6;
snapshot hash `48b797bd2b4f72368acfb854a0c8d954f49049c9b62e79ecf893c0880078c1b4`,
source `portfolio-registry:2026-10-14+p10-adapter-only-manifest-cc2cc620`.
This is routing evidence, not a fresh LinkedIn account check. Re-read live task,
attempts and manifest immediately before any mutation; this example is not a
standing release for another revision or future publication.

```json
{
  "projectId": 7,
  "taskId": 1136,
  "actorId": "user:2",
  "snapshot": {
    "projectId": 7,
    "taskId": 1136,
    "channelId": 6,
    "contentRevision": 5,
    "bodySha256": "f2466094882cb20ec280d5f8f72411cb832cd5d8fc95aed6edbe0c4904b75262",
    "scheduleAt": "2026-10-16T14:00:00.000Z",
    "publishAt": "2026-10-16T14:00:00.000Z",
    "selectedAssetId": 166,
    "assetSha256": "d94cdcaa61a09fb9e00de4a09289e929c4eb3df4bb33361b98df226e3245e701",
    "decisionId": 327,
    "decisionVersion": 4,
    "manifestChecksum": "sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd",
    "contentLanguage": "en",
    "identity": {
      "platform": "linkedin",
      "accountType": "company_page",
      "accountRef": "seturon_linkedin_page",
      "profileUrl": "https://www.linkedin.com/company/seturon/",
      "providerAccountId": "97416172",
      "registryReference": "portfolio-registry:v36:profile_seturon_linkedin_page",
      "registryEvidenceSha256": "48b797bd2b4f72368acfb854a0c8d954f49049c9b62e79ecf893c0880078c1b4"
    }
  },
  "approvalReference": "Portfolio HQ user 01a148bc-16c4-7931-817a-2814a1282d3a approved 004; publication GO 01a1466f-316d-78b2-bda4-5178168dbaf1",
  "idempotencyKey": "p7-task1136-r5-metadata-004-v1",
  "apply": false
}
```

The MCP principal replaces actor identity and enforces its outer project;
server-side snapshot validation also rejects a hidden different project/task.

### LinkedIn without a visual

Personal and company-page LinkedIn packages may use `selectedAssetId:null` and
`assetSha256:null` together. This is not a missing-asset fallback: current task
state and the exact active, same-tenant/task/channel/feed/revision/version art
decision must both say `NO_VISUAL_NEEDED`, with no selected asset and no required
visual mode. The full identity, manifest, accepted body and date bindings remain
mandatory. LinkedIn text must be nonempty and at most 3,000 characters; X keeps
its separate 280-character limit and signed-native execution boundary.

For this package the native observation must contain zero attached images and
`observedAssetSha256:null`; an unexpected image rejects pre-submit/confirmation.
Image-bearing LinkedIn, DEV.to and Setka requirements do not change. No fake
asset, new approval, account, credential or alternate publication route is needed.

## Operator sequence

1. `ba_diagnose_browser_publication`: inspect persisted attempts/WI/fact without
   credentials or leases. An existing attempt means reconciliation, not retry.
2. `ba_inspect_browser_publication`: read-only exact package preview. Then
   `ba_repair_browser_publication_metadata`, first preview and separately apply
   the same snapshot with `apply:true`; only task/handoff language and audited
   owner-adopted identity change. Accepted copy/date/channel/art/asset stay.
3. `ba_release_browser_publication`: preview, then apply with a separate stable
   release key. It creates one revision-bound WI, no delivery attempt or click
   permission. Keep its returned work-item ID.
4. `ba_claim_browser_publication`: same package plus workItemId, separate claim
   key; keep returned lease private. Expired pre-start claims may be reclaimed,
   but an old claim key cannot retrieve the replacement generation.
5. `ba_start_browser_submission`: same package/workItemId/leaseToken, one stable
   send key. One durable attempt is recorded before provider interaction.
   Start returns `submission_permitted:false`; never treat its receipt as send.
6. Owning Publisher performs the required actual no-send/action-time check:
   exact author/company ID, accepted body and ordered paragraph hashes, one
   approved image with matching SHA (or zero images for canonical text-only
   LinkedIn), no duplicate. Submit these observations
   through `ba_pre_submit_browser_submission`, including attemptId and evidence
   hash. Only the first successful response permits one Submit, within returned
   30-second/lease expiry. A replay/lost response does not renew permission.
7. After the actual click, read back native object ID/permalink, actual timestamp,
   author, exact blocks and image. `ba_confirm_browser_submission` atomically
   completes the same attempt, work item, audit and canonical fact. Native time
   must be within attempt-start minus120s and current time plus30s, not backdated
   to the planned slot. Evidence hashes are attributed executor observations,
   not independently signed/server-queried provider proof.
8. Lost/uncertain result: `ba_mark_browser_submission_uncertain`; never reset,
   resend or change the send key. Use `ba_reconcile_browser_submission` with
   actual existing-object readback, without leaseToken, including expired lease.
   If absence is asserted, preserve it as operator evidence and use a separately
   governed recovery; this package does not silently authorize a second attempt.

Reconciliation rejects an otherwise healthy active lease: explicit UNKNOWN or
an expired lease is required. Normal confirmation checks the provider action
timestamp against the recorded finite permit deadline; an on-time action may
be read back later, but a late action cannot use ordinary confirmation.

DEV.to uses the same controls with its accepted article/cover/profile snapshot;
its permalink must belong to that profile and native article ID must be numeric.
No API alternative or future publication authority is inferred.

## Compatibility and rollback

No schema migration or credential store. Existing exact lifecycle history is
unchanged. Generic dispatch and generic manual fact writes reject a shared
governed package; they cannot rearm its WI or impersonate confirmation.

Safety fences are isolated in commit `210ae9324c054b8136fd0dacbb83bfd96f51f602`.
Before or after release, rollback must RETAIN recognition of shared_browser_v1
and adopted browser identity in dispatch/manual-fact fences. Disable/unregister
new admission/claim/start/pre-submit mutations or revert the later lifecycle
commit while keeping this compatibility commit. Prefer retaining diagnosis,
uncertain marking and reconciliation for in-flight work when their checked
implementation remains safe. Never wholesale revert to pre-004 behavior after
a shared package exists: old generic browser fallback can rearm work and is not
an acceptable rollback. Preserve WI/lease/attempt/fact/audit rows, with no state
reset, baseline widening or automatic metadata/data rollback.

Engineering tests do not establish live browser readiness or owner UAT. Require
checked deployment, production control-plane readback and the owning Publisher's
actual no-send gate before the one authorized publication.
