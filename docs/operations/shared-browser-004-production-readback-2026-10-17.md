# 004 browser milestone: production readback, 2026-10-17

## Verified deployment (not a publication)

- PR166 merged as `56c432ab06e938b06a1dd18e42bbfe158b56e3a8`.
- PR167 merged as `3472a06450d9448b5d1a9b8adaa86f2e17fffdd6`; source tree
  `99b4c5509c815dee59746495b3f79848b7660732`, same as checked head `b685241`.
- All five PR167 checks SUCCESS at that checked head. Security findings in
  confirmation were reproduced RED, fixed and independently source-reviewed.
- GitHub commit deployment statuses: planner-app SUCCESS at 08:03:05 UTC,
  planner-mcp SUCCESS at 08:03:23 UTC. Railway deployment7136758433 SUCCESS
  at 08:03:26 UTC for the exact merge SHA.
- Bounded non-root Docker health probes: both URLs HTTP200/status ok;
  new app uptime34s and MCP uptime16s. MCP bearer_required/principal_scoped true.
- Fresh connected p7 manifest/bootstrap succeeds with unchanged checksum
  `sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd`.

## Exact remaining boundary

Current development chat tool catalog still lacks the new generic tools after
successful reconnecting calls to the existing Publisher manifest/bootstrap.
The execution functions are absent from the exposed tools object. Therefore
production tools/list availability and no-write preview are NOT verified;
deployment/source registration alone is not claimed as that verification.
Refresh/reconnect the existing p7 Publisher MCP without changing URL/token or
granting new permissions, then continue the documented canonical commands.
No credential extraction, direct DB writes, alternative API/browser route or
temporary role widening is authorized as a workaround.

## Prepared handoff, not an executed release

Single existing owning chat: Seturon — Publisher / SMM,
`01a13a4f-6dbf-7623-89a6-1651eefdaa8a`. No second Publisher was started.
Fresh p7 task1136 readback: accepted/current revision5, channel6, approved
asset166, schedule_at/publish_at both2026-10-16T14:00:00.000Z,
status ready_for_execution, publication_mode approval_required,
handoff language ru, no browser work item, publication_fact/published_link null.
This does not replace the new transaction's prior-attempt check.

The exact validated request/Registry company97416172/body and JPEG SHA bindings
are in `shared-browser-publication.md`. Re-read current task/manifest immediately
before use. Next commands, in order:

1. ba_diagnose_browser_publication
2. ba_inspect_browser_publication
3. ba_repair_browser_publication_metadata (preview, then apply)
4. ba_release_browser_publication (preview, then apply)

Only after the recorded release WI exists may the sole Publisher use:
ba_claim_browser_publication, ba_start_browser_submission,
ba_pre_submit_browser_submission, ba_confirm_browser_submission.
Uncertainty uses ba_mark_browser_submission_uncertain and
ba_reconcile_browser_submission, never another send/reset/key.

Engineering did not apply metadata, create a release/WI/attempt/fact, open a
provider or click Submit. Existing owner approval remains; no repeat copy GO is
needed. Live action-time check and owner UAT are not established by these tests.
DEV.to task1118 shares this deployed control-plane contract but its live scoped
readback/release/UAT is still pending. Telegram task1103 still requires normal
review/Art recovery, unchanged MP4 revision rebind and generic video transport.

Rollback must retain compatibility fence commit210ae93 and all persisted
history; no wholesale pre-004 rollback after a shared package is materialized.
The three bounded static-scanner P2 followups recorded in TRUN remain open;
neither scanner completeness nor whole-repository debt elimination is claimed.
