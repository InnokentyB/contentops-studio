# VK Clips production gate

Checked: 2026-10-09. Status: OFFLINE IMPLEMENTATION / LIVE DRIVER AND OWNER UAT BLOCKED.

## Operator outcome

An owner-approved, revision-bound MP4 must be published as a VK Clip in the
Registry-bound account/community. A wall post, ordinary VK video, or Story does
not meet this outcome. Existing feed/video tasks must retain their approved
placement; task #1084 is not authority for a new Clip or for reopening a retired slot.

## Engineering boundary implemented locally

- Planner has explicit `clip` placement, Clip artifact/materialization and
  `vk_clip:publish` handoffs. Authority remains `manual_only`; an ordinary feed
  MP4 is never converted to a Clip. Both handoff paths require the current accepted
  caption and selected approved HTTPS MP4, SHA-256, positive byte size and known
  9:16 dimensions. This is an editorial canvas contract, not a VK upload-limit claim.
- Exact owner release checks project membership, manifest checksum, channel,
  revision, asset hash, schedule and placement. Existing publication facts,
  delivery attempts and active browser work block a new release.
- Worker orchestration has a Clip-specific UI port, bounded operations, a recent
  complete pre-upload baseline, durable submission claim before upload, provider
  readback and uncertainty recording. Ordinary video/post controls are not fallback
  paths. Ambiguous or interrupted submission requires reconciliation, never resend.
- Server confirmation requires a new `short_video` object in the intended
  community, canonical Clip permalink, provider timestamp, fresh baseline/readback
  and matching selected-media hash. The fact transaction rechecks task, revision,
  asset and lease before finalization. Facts retain the existing `video` artifact
  kind with Clip identity evidence; measurement remains a manual checkpoint.

These changes are local engineering work. They do not establish a live provider
upload contract, a production deployment or a successful Clip publication.

## Live driver and policy blocker

The existing `vk_native_video_adapter.ts` is offline orchestration for
`video.save` / upload / `video.get` / `wall.post`, not a Clips implementation.
The published VK API 5.199 schema describes `video.save` but does not provide an
explicit Clip-creation parameter in that method. The video object schema includes
`short_video`; object recognition alone does not establish an upload contract.
No authenticated undocumented Clip API call was attempted.

The concrete driver remains `UnverifiedVkClipUi`: every operation fails closed.
The CLI rejects a Clip job with `VK_CLIP_UI_UNVERIFIED` before MCP requests,
lease claims or browser startup. The orchestration tests use synthetic UI evidence;
they do not verify the real VK editor or justify enabling its driver.

Primary sources inspected:
- https://github.com/VKCOM/vk-api-schema/blob/master/video/methods.json
- https://github.com/VKCOM/vk-api-schema/blob/master/video/objects.json

The authorized Chrome VK tab was rejected by Browser Use on 2026-10-08:
`Browser use is not permitted on https://vk.ru/im/convo/-22884714`.
This was a site-safety policy denial, not an automatic approval review or a
missing user confirmation. Other browsers, domains, raw CDP, workers, cookies,
or API calls must not be used to circumvent the rejected browser operation.

## Required acceptance scenarios before enabling a transport

1. Explicit Clip placement survives plan, editor/art acceptance, handoff,
   owner release and dispatch. A vertical MP4 never changes placement implicitly.
2. Server-side project membership and exact Registry identity are checked.
   Current accepted revision, selected approved asset and its SHA-256 are pinned.
   Retired/cancelled tasks, stale revisions and expired leases cannot dispatch.
3. A verified provider contract supports creation/upload in the intended account
   with current authorization. UI selectors, if used, are grounded in the actual
   authorized editor rather than inferred from ordinary video controls.
4. The durable claim is committed before the first provider mutation. Allocation,
   upload, processing and submission checkpoints retain provider identity;
   processing resume cannot repeat allocation/upload. An uncertain outcome blocks
   resend even with a different idempotency key.
5. Confirmation requires the exact community/account, Clip object kind, accepted
   text and media, canonical Clip permalink and provider timestamp. An old Clip,
   ordinary video/wall URL or ambiguous match cannot create a publication fact.
6. Upload endpoints are validated and redirects cannot disclose credentials.
   Signed upload URLs, cookies, bearer tokens and raw provider errors are absent
   from persistent records, logs and returned evidence.
7. Focused acceptance/regression tests, backend build and `quality:gate` pass.
   Deployment is followed by owner UAT with an approved concrete Clip and
   independently verified provider identity, Planner fact and measurement work.

## Next boundary

Obtain a permitted, verified provider interface or owner-supplied manual editor
evidence and manual UAT. A chat approval alone cannot override Browser Use policy.
Then implement and test a real Clip driver against that permitted interface,
including provider-derived identity, timestamp and acknowledgement binding the
uploaded bytes to the returned Clip. Confirm a usable project-10 Publisher MCP
credential and dedicated authenticated browser session, deploy the verified
implementation, and complete owner UAT with one exact approved task. Project-10
Publisher credentials are not available in the current local MCP configuration.
Do not enable publication or report production completion while these remain
unresolved.

## Credentials are separate from Radar search

`VK_USER_API_TOKEN_REQUIRED` belongs to the External Radar API search adapter.
It is not the authorization gate for this browser Clip route. The eventual Clip
worker needs a project-10 Publisher MCP token for Planner operations and a
dedicated authenticated VK browser session for the intended community. Obtain
and configure these through the owning credential/session setup, never chat,
job files, screenshots or logs. No token or session was changed by this work.

No production transport, authorization setting, publication task or provider
state was changed during this work. Deployment remains blocked pending the real driver and owner UAT.

## Local verification (2026-10-09)

- Focused Clip, existing VK worker/release/confirmation, placement and fact tests: 99/99 PASS.
- Remote MCP identity and security/key tests with offline test configuration: 20/20 PASS.
- Backend and frontend builds: PASS. Repository quality gate: PASS, existing score 77 unchanged.
- Full configured suite: 677/684 PASS; seven existing preparation/Telegram cases fail because
  the local database `innokentyb` is absent. No production database was used to bypass this.
- Real VK editor, upload, public Clip, database concurrency integration and owner UAT:
  NOT VERIFIED. Synthetic port tests do not establish production readiness.
