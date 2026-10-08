# VK feed video boundary

An approved MP4 in VK `feed` remains `feed`; it is not a story or clip.
Handoff uses `vk_video:publish`, `publication.video_url`, a video resource and
the selected asset dimensions. `image_url` is null. Connector authority stays
manual-only until native video transport is explicitly enabled and validated.
Existing text/photo publication must not receive MP4. Task dry-run reports
`vk_native_video_adapter_unsupported` independently of generic VK credentials.

`vk_native_video_adapter.ts` is offline orchestration, not a live transport.
It requires policy clearance, explicit capability, checksum-bound bytes and a
durable atomic claim port. Save/upload/readback/wall checkpoints preserve
uncertain outcomes; signed upload URLs and raw provider errors are not persisted.
Processing media is not posted. Live transport, durable claim implementation,
processing resume and owner UAT are still required before enabling this route.
Provider schema: https://github.com/VKCOM/vk-api-schema/blob/master/video/methods.json

Exact p10/task1084 administrative tool `ba_hold_vk_task1084` defaults to preview.
It checks owner membership and exact rev1/channel117/decision246/asset118/hash.
Preview projects only safe attempt and lease fields. An applied hold requires
the preview body hash, approval reference and idempotency key; it changes only
status, handoff state and audit metadata. It refuses active or indeterminate
leases and publishing state. It never resets claims, attempts, accepted content,
assets, owner release or publication facts. Existing attempts require separate
readback; their presence is not permission to resend.

Exact owner correction `ba_restore_vk_task1084_from_erroneous_retirement`
restores only p10/task1084 when retirement audit 2629 contains that task. The
caller supplies matching durable Registry and live manifest evidence. The tool
also requires the unchanged accepted rev1/body and approved asset118/MP4 hash,
no publication fact, no provider attempt and no active lease. Preview is the
default. Apply is idempotent and changes only the task lifecycle to
`status=blocked`, `handoff_state=blocked`, `publication_mode=owner_released`,
adds the owner correction audit, and creates or reuses one blocked native video
transport work item. It preserves the old schedule as history and never assigns
a recovery slot, sends, or records a publication fact. Schedule recovery happens
only after the native video route is operational and separately authorized.

For #1084, the explicit browser policy deny remains a hard stop. Do not switch
URLs, browsers or APIs to bypass it. The owning SMM is the sole live sender.

Rollback: revert this commit and redeploy. An applied hold is intentionally not
auto-released on rollback; owner must review provider state before audited release.
