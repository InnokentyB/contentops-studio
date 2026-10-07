# Exact owner releases: 1033 / 1035

The publisher profile exposes `ba_release_x_task1033_browser` and
`ba_release_approved_threads_task1035`. Authenticated remote identity remains
authoritative; both services independently require project-owner membership.
These are fixed packages, not generic permission expansion.

- X: project10, channel164, task1033 revision2, decision243 version1,
  completed review1549 revision2/result2 and art1560 revision2/result1,
  schedule/publish time `2026-10-07T15:00:00.000Z`. One browser work item;
  the owning publisher uses `ba_claim_x_browser_publication`.
- Threads: project10, channel138, task1035 revision1, decision244 version1,
  completed review1550/art1561 revision1/result1,
  schedule/publish time `2026-10-07T16:30:00.000Z`. Existing native
  `ba_publish_threads_task` checks release proof and performs the send.

Both releases verify fixed accepted-body hashes and manifest v21 checksum,
NO_VISUAL/feed, absence of publication facts/attempts and existing browser work.
Threads also verifies `innokentybo` provider identity and provider post history.
Neither release sends, uploads, claims browser work or records publication facts.
The sole owning SMM performs publication; uncertain outcomes must not be resent.
These changes do not authorize bypassing any VK browser restriction or changing
the transport of VK task1084.

Rollback: revert these registrations/specs/claim addition. Preserve audit events,
facts and revision-bound work items; do not delete released work or undo a
confirmed publication. Disable execution before rollback if a release has run.
Local tests/build are engineering evidence, not owner UAT or provider success.
