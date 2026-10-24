# Browser attempt key contract

The `idempotencyKey` supplied to `ba_start_browser_submission` becomes the immutable delivery-attempt key. Supply that same value with the same attempt ID to pre-submit and confirmation/reconciliation operations that validate the attempt. Do not create a separate per-stage pre-submit key. Claim/release/recovery operation keys have their own contracts; a recovery operation key does not replace the original delivery-attempt key.

If the key differs, the existing top-level `BROWSER_RECONCILIATION_REQUIRED` remains compatible. Safe structured reasons identify `BROWSER_ATTEMPT_KEY_MISMATCH`; neither stored nor supplied keys are returned or logged. The diagnostic also reports independently observable non-pending state and history conflict, in that order after the key reason. A missing scoped row reports only scope mismatch; it does not infer a key mismatch against another tenant or channel.

Correcting the request key never renews an expired lease, changes a package, replaces an attempt, or grants Submit. Preserve the same original attempt. Expired historical preparation requires the approved same-attempt custody/fencing/readback mechanism and an actually registered owning executor. An empty provider feed, no stored permit, timeout or Owner statement alone cannot prove that an old/offline executor cannot send.

The existing LOCK-028 implementation packet is separate from this diagnostic patch. The current production default has no registered historical supervisor/reader. A live operator must receive an explicit unsupported/held result until those real ports and no-send verification are present. Never replace this dependency with SQL reset, new attempt, a new key or a second sender.

Validation: synthetic scope/key/status/history matrix; actual operator error serialization and safe boundary log; exact-key positive case; unchanged shared release/claim/permit/confirmation/reconciliation regressions. Rollback returns to the prior generic diagnostic while retaining all attempt/lease/history checks; no schema or data migration is required. Owner/provider UAT is separate.
