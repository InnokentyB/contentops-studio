# Setka through the shared browser lifecycle

Setka personal image posts use the existing ten shared browser controls in
[the operator sequence](./shared-browser-publication.md#operator-sequence).
There is no task-specific tool, provider API fallback, new executor or implicit
publication permission. Engineering deploys this control plane without releasing,
claiming or sending a publication. Use the existing owning Publisher and its
actual scoped principal, approval and browser authority.

## Provider contract

- Platform `setka`, account type `personal`, placement `feed`.
- Profile `https://setka.ru/users/<UUID>` must exactly match the provider account
  UUID, Registry routing evidence and current channel profile/account reference.
  Legacy Setka config `account_type: unknown` is accepted only for an explicitly
  owner-adopted personal UUID snapshot. An explicit company type is rejected;
  channel config is not rewritten. LinkedIn/DEV.to type checks are unchanged.
- Approved revision-bound managed R2 PNG/JPEG and active `GENERATE` decision are
  mandatory. Text-only, unapproved, stale or different images are not admitted.
- Native readback is `https://setka.ru/posts/<UUID>`, with that exact UUID as
  `providerObjectId`. Query, fragment, credentials, nondefault port and other
  host/path are rejected. UUIDv7 is supported; an optional trailing slash is
  normalized. Native author, exact text blocks, image SHA, actual publication
  time and evidence hashes remain mandatory in the common confirmation flow.
- Registry evidence and executor observations are not independent server-side
  provider attestation. The Publisher must inspect the actual profile, attached
  resource, accepted text and duplicate state at action time. The 30-second
  single-use permission is not renewed by replay. UNKNOWN/started/expired
  in-flight work requires same-attempt reconciliation, never resend.

## First consumer readback (not a release)

Read on 2026-10-17: project10/task1124, channel126 `analystcraft_setka`, accepted
revision2, decision332/version1, approved selected asset171, `feed`, handoff ready,
no publication fact or public link in the task readback. Body/date/art/asset
records were not changed by engineering. Re-read live state and diagnose attempts
before mutation; this document does not prove the absence of an in-flight send.

Expected package data, to compare against a fresh owning-Publisher readback:

```json
{
  "projectId": 10,
  "taskId": 1124,
  "channelId": 126,
  "contentRevision": 2,
  "bodySha256": "a11b9860bf5fe3a54363a6d3f9f88180da67f42b0bf7c4e1293f935d4d2a37ef",
  "scheduleAt": "2026-10-17T14:00:00.000Z",
  "publishAt": "2026-10-17T14:00:00.000Z",
  "selectedAssetId": 171,
  "assetSha256": "996769efe3670d89ce4eed4c0632fccd3edc3c6d1a3e496159727810641abed0",
  "decisionId": 332,
  "decisionVersion": 1,
  "manifestChecksum": "sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7",
  "contentLanguage": "ru",
  "identity": {
    "platform": "setka",
    "accountType": "personal",
    "accountRef": "analystcraft_setka",
    "profileUrl": "https://setka.ru/users/019c99e2-fb9d-78e0-9876-9c4a360bb4dc",
    "providerAccountId": "019c99e2-fb9d-78e0-9876-9c4a360bb4dc",
    "registryReference": "portfolio-registry:v36:profile_126",
    "registryEvidenceSha256": "48b797bd2b4f72368acfb854a0c8d954f49049c9b62e79ecf893c0880078c1b4"
  }
}
```

The body hash above is the owning Operations expectation; resource metadata is
JPEG1200×900 RGB/219988bytes. Actual body/resource bytes and selected active
decision must be checked fresh, not inferred from this document. The scheduled
time is 15:00 Europe/Lisbon; do not move/backdate it. Registry v36 was read-only
verified in the local canonical CRM snapshot (2026-10-14), entity `profile_126`,
owned personal profile. It is routing evidence, not a provider login check.

## Release and rollback

Use `ba_diagnose_browser_publication` and `ba_inspect_browser_publication` first.
Metadata repair and release default to preview; apply only under existing owner
authority with stable separate idempotency keys. No new GO for future packages
is inferred. Never use the old exact Setka task1047 route for this task.

No migration or credential changes. If admission must be withdrawn, disable
Setka repair/release/claim/start/pre-submit admission but retain shared lifecycle
recognition, attempt history and diagnosis/reconciliation. Do not revert the
shared safety fences or reset in-flight state. Rolling back an unstarted
package does not authorize another publication attempt.

Engineering verification is recorded in
[the Setka TRUN](../tdpd/shared-setka-browser-trun.json). Provider UAT and live
execution remain separate; synthetic GREEN is not owner acceptance.
