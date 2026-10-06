# Dzen #999 existing-draft recovery

`ba_resume_dzen_task999_existing_draft` is scoped to project 10, channel 116,
accepted revision 2, approved asset 114 and draft `6ac547ad5113b334aeff83d2`.
The only allowed key is the original
`dzen-999-owner-approved-live-20261006-v1`. The actor must be a current project
owner; the publisher profile can access this tool, not a planner profile.

Start with `confirm: false` (the default). Preview reads the published list,
requires the exact draft in the draft list, compares its title/body and native
preview image with the original approved JPEG checksum, and opens only the
confirmation drawer. The editor help overlay is closed by its explicit close
control, and its removal is awaited before the header click. Preview never
claims or performs the final submit. A full published-list page fails closed.

Only the designated SMM sender may call `confirm: true` after a successful
preview. A fresh preflight runs again in the same browser before a serializable
CAS and audit event bind recovery to the original claim and unchanged package.
The original uncertain delivery is retained in audit history. The browser never
opens a new composer, types content or uploads an image. One final confirmation
is permitted. An exact provider object, public URL, publication timestamp and
public-body readback are required before recording a canonical fact.

After a claimed resume, all further resume calls are blocked, including after an
uncertain response or fact-write failure. Reconcile the existing provider object;
do not reuse the full publication route or remove the gate manually. Reverting
this code disables the capability but must not revert audit events or facts.
