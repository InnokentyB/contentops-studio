# Owner-release schedule correction

Use `ba_correct_owner_released_task_schedule` only when an unpublished Telegram
task already has an exact owner-release proof but its scheduled time is wrong.
The operation never publishes and never silently carries authority to the new
time.

Required readback before calling it:

- current workspace manifest checksum;
- task/project/channel identity;
- accepted and content revisions;
- body SHA-256;
- selected approved asset and visual state;
- exact current `schedule_at` and `publish_at`;
- absence of a publication fact, public URL and every provider attempt.

The call is project-owner-only and idempotent. It uses compare-and-swap guards,
changes only `schedule_at`, `publish_at`, and `publication_mode`, and records the
superseded release event in the audit trail. The resulting mode is
`approval_required`.

After successful correction, obtain a fresh manifest and task readback. The
owner must then call `ba_release_approved_telegram_task` with the new schedule,
the unchanged accepted revision/body/channel/asset, a new approval reference,
and a new idempotency key. Publisher execution remains a separate explicit
operation.

Stop without retrying when the tool reports a stale manifest, guard mismatch,
existing delivery attempt, publication fact, release-proof mismatch, or CAS
conflict. Reconcile that state before any new release or send.
