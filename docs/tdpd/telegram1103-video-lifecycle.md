# Exact Telegram video recovery #1103

## Approved boundary

Human LOCK/QAR/ARCH/RISK approval: “Да, принимаю пакет #1103”. Exact project10,
task1103/channel109 `@analystcraft`, accepted target revision2, original MP4
asset142/SHA `23a3dc6208457cb78de4a8e92ee995a67d682ecec9cec703cb38ad53b5730b43`.
The existing MTProto adapter is retained. Body, original schedule/publish dates,
tokens, R2 object and every other task remain unchanged. No regeneration.

## Operator sequence

1. Editor obtains the safe review snapshot for WI1756, previews/applies the
   audited review collision repair. Old approval325, result2 and Art285 remain
   immutable history. A new content_review/result0/context2 is created.
2. Normal Editor review accepts the exact current r2. Normal Art direction
   creates an active r2 SOURCE_REQUIRED/MANUAL_ASSET_REQUIRED decision.
3. Art previews/applies `ba_rebind_telegram_video_task1103_asset` using that
   decision and both exact body/media hashes. Asset142 is forward-bound to r2
   as candidate with old binding/QA provenance; one new visual review is required.
   No new asset, R2 mutation, automatic acceptance or release is performed.
4. Normal visual acceptance selects approved142/r2. Prepare/resource readback
   must expose video_url, image_url=null, MIME video/mp4, never photo materialization.
5. Owner Publisher previews/applies `ba_release_telegram_video_task1103` with
   current manifest, caption/media hashes and approval reference. This binds
   channel configuration, source URL and approved asset metadata, without sending.
6. `ba_publish_telegram_video_task1103` dryRun=true verifies bounded original
   bytes and MP4 video-track dimensions/duration, without an attempt or provider write.
7. One explicit live call with stable idempotency key records a serializable
   publishing claim and durable pending attempt before one native sendFile.
   Readback verifies exact target, caption, video type, size and message identity
   before atomic video fact/attempt completion. Generic manual fact is denied.
   The generic ba_publish_publication_task surface rejects #1103, including
   dry-run; use its dedicated Publisher command. Other non-story Telegram MP4s
   remain manual-only/unsupported and cannot fall through to the photo sender.

UNKNOWN/started/finalization error means reconciliation-only for every key. Do
not reset state, resend, choose another transport or manufacture a fact. A verified
provider receipt is audit evidence, not alone a fact. If a recovery command is
missing, stop at that boundary and retain the attempt for an audited repair.

## Traceability / test run

- MIME RED: existing handoff exposed MP4 as image and Telegram video_cover was absent.
- Collision RED: r2 repair rejected the Telegram route as manual-only.
- Replay RED: committed release could not be read during manifest outage.
- Storage RED: malformed URLs raised unbounded URL errors.
- Fact RED: generic manual fact bypassed the exact MP4 readback boundary.
- Focused mocks cover tenant/owner/role fencing, no mutation in preview/dry-run,
  stale hashes/config, source binding, rollback, normal acceptance gates, one
  durable attempt before adapter, video fact after readback and UNKNOWN freeze.
- Isolated PostgreSQL CI covers same-row rebind rollback/no duplicate asset,
  concurrent claim/single adapter call and real atomic canonical video fact.
- Resource-only original R2 read: 4,022,731 bytes, SHA PASS, 1080×1920,
  duration42.766666666666666 seconds. No Telegram provider call during that read.

Engineering GREEN is not owner UAT or live publication. Save scenario-level CI,
commit/deploy and actual production readback with the final handoff.

## Compatibility / rollback

No migration, new environment variable or credential storage. Existing JPEG feed,
Story and other platforms retain their prior semantics. This exact route requires
the pre-existing R2_PUBLIC_BASE_URL and project MTProto session. Reverting the
change removes new admission; preserve all review/approval/rebind/release/attempt/
fact history. Never downgrade approved/r2 metadata or rewrite old decisions to
manufacture another send. A started attempt stays frozen even after rollback.
