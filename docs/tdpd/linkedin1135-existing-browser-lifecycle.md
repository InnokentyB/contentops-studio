# LinkedIn1135 — existing browser lifecycle, exact package

## Approved boundary (16 October 2026)

Owner GO relayed by AnalystCraft Ops `01a0c579-1ac5-7011-b7be-a99fd03cda8b`:
“1135 публикуй”. Portfolio HQ `01a041f1-23c2-7092-a53a-4d4141a55a62`
confirms continuation without bypassing engineering gates or site/action denials.
The requested implementation is bounded reuse of the existing browser lifecycle,
not a new API transport or standing publication authority.

LOCK: p10/task1135/channel179, AnalystCraft company79633032, accepted/content r2,
asset163, feed, dates 2026-10-16T10:30:00.000Z. Body SHA
`b9a402f4b864ef3808f79515ea820d5c337300d521381ad2aea451230309093c`;
image SHA `b8de74ce57aaf6abc0c4b2c75521e18972caaa39abd0ebc7c60bf337bfc0a838`.
Preserve all 15 ordered paragraph blocks and attach exactly the approved image.
No personal LinkedIn, Seturon, other task, copy/date/asset or credential changes.

QAR: zero additional attempts for any prior attempt/UNKNOWN; durable attempt
before any provider mutation; current owner/tenant/package/lease checks; observed
company author, exact caption/paragraph structure and one image before Submit;
atomic fact/attempt/audit completion after canonical public readback. Tests must
cover rollback, concurrent release/start, expired lease reconciliation and raw
lease absence in audit. Engineering verification is not human UAT.

ARCH: add one data package to the existing exact browser engine. Reuse shared
package/release/start/lease validators. New wrappers supply pre-submit and atomic
confirmation/reconciliation. No migration, new env, browser driver or provider
API. The narrow claim retains the existing WI lease model but stores only its
fingerprint in audit; the reusable token is returned only to its owning executor.
Existing records/events are never rewritten.

RISK: stale snapshot, wrong company, stale/foreign image, collapsed text blocks,
parallel claim/start, revoked owner, expired lease and unverified receipt fail
closed. No raw browser/provider error, credential, cookie or lease enters new
audit events. Generic manual fact cannot manufacture success for this task.
Existing attempt always means read-only reconciliation, never another Submit.

## Operator workflow

All commands are publisher-profile/owner scoped. Authenticated principal overrides
caller identity. Begin with manifest and publisher bootstrap, then
`ba_diagnose_linkedin_task1135_browser` using projectId10/taskId1135/actorId.

1. `ba_release_linkedin_task1135_browser`: projectId10, taskId1135, actorId,
   expectedManifestChecksum `sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7`,
   expectedBodySha256 above, expectedScheduleAt `2026-10-16T10:30:00.000Z`,
   approvalReference to direct owner GO, truthful duplicateCheckReference and a
   stable idempotencyKey. Creates one available browser WI, does not publish.
   A Planner-only duplicate scan is not provider absence; disclose its limit.
2. `ba_claim_linkedin_task1135_browser_publication`: projectId10, actorId,
   workItemId returned by release, stable claim key, optional leaseSeconds<=1800.
   Keep the returned lease private to the executor; never copy it into notes.
3. `ba_start_linkedin_task1135_browser_submission` immediately before any
   company composer or image mutation. Boundary arguments: projectId10,
   taskId1135, channelId179, actorId, workItemId, leaseToken, approvalReference,
   stable submission idempotencyKey, contentRevision2, textSha256 above,
   selectedAssetId163 and imageSha256 above. Receives attemptId. One start only.
4. `ba_pre_submit_linkedin_task1135_browser_submission` before clicking Submit:
   same boundary + attemptId + observedAuthorUrl
   `https://www.linkedin.com/company/79633032/`, observedAccountType
   `company_page`, observedTextSha256, observedImageSha256, attachedImageCount1,
   paragraphBlockSha256, duplicateAbsent=true and evidenceSha256. Hash each
   actual observed paragraph after trimming its boundaries, in original order.
   Expected hashes from diagnosis are comparison targets, not a substitute for
   observing the real composer. Inspect the company feed for duplicates. An
   uploaded-source image hash binds the selected original file; provider image
   recompression is not expected to preserve binary SHA. Verify its visible
   appearance and attachment separately. Do not bypass any safety denial.
5. `ba_confirm_linkedin_task1135_browser_submission`: same observed/boundary
   package + publicUrl, providerObjectId `urn:li:activity:<id>`, actual publishedAt
   and public readback evidence hash. Requires a prior matching pre-submit check.
   Fact, attempt completion and audit commit in one transaction.
6. On UNKNOWN, `ba_mark_linkedin_task1135_browser_submission_uncertain` takes
   boundary+attemptId and bounded reasonCode (PROVIDER_RESULT_UNCERTAIN,
   PRE_SUBMIT_REJECTED, BROWSER_UNAVAILABLE). Do not resend. If lease expired,
   diagnosis still shows the pending attempt; do not reclaim for another start.
7. `ba_reconcile_linkedin_task1135_browser_submission` requires the same exact
   observed public-object proof as confirmation, but omits leaseToken. Only
   current owner may reconcile the existing attempt. It never renews a lease,
   creates a second attempt or authorizes provider mutation. Without reliable
   object/readback evidence it remains UNKNOWN. No safe-retry claim is made.

Rollback: disable this package/tool prefix and hold its WI. Retain release,
lease fingerprints, attempts, provider evidence and facts. Never reset or resend
an uncertain task, delete history or revert a confirmed provider object.

## Verification record

RED: publisher capability test failed on absent exact1135 release tool.
Local focused service/capability tests exercise real exported boundaries with
synthetic DB state; real PostgreSQL CI covers release/start races and rollback
plus normal claim/pre-submit/atomic fact completion. Fixture contains only
owner-approved public copy, no provider/session/credential material. CI and
production results are recorded with the resulting PR/deploy/readback, not
inferred from these assertions. Human UAT/publication outcome stays explicit.

## Provider identity compatibility repair (2026-10-16)

Live attempt42 received LinkedIn's native `urn:li:share` object, not an activity.
The exact task1135 confirm/reconcile boundary accepts either actual namespace and
requires matching HTTPS `www.linkedin.com/feed/update/<same-URN>/`; it never
converts a share number into an activity number. An optional actorCompanyId must
be exactly 79633032; credentials, foreign hosts, mismatching IDs and other query
parameters fail closed. Other task packages and all submission/retry controls
are unchanged. UNKNOWN remains reconciliation-only, including after lease expiry.

RED: native-share reconciliation failed on the former activity-only schema.
GREEN requires the focused contracts and isolated PostgreSQL atomic fact test.
Rollback: revert this compatibility patch; preserve attempt42, pre-submit audit
3339 and uncertain audit3340. Do not reset/release/retry the provider action.
Live readback must verify source link expansion when LinkedIn shortens its URL.
