# Reused content-review version recovery

Work-item result versions are independent of content revisions and writer result
versions. Completing a replacement writer reopens review without resetting its
result version; previous reviewer leases and payload are invalidated. Submitting
review advances beyond both the current work-item version and every historical
approval version, with the reviewed content revision stored in the payload.

For the production #1040/WI1605 collision, the owning operator re-reads the exact
English revision 4 and calls owner-only `ba_recover_content_review` with project10,
task1040, workItem1605, expectedContentRevision4, a stable recovery key and evidence
describing the historical approval-version collision. No body or schedule changes.

An old payload lacking an explicit current-revision binding is not treated as a
fresh submitted review. Recovery preserves historical decisions and the old
payload, completes the superseded item and creates a new revision-bound review.
The owning editor must read the returned new WI, claim and submit a fresh review,
then decide its exact returned result version. Art direction must be refreshed
before release. No stale Russian approval, automatic acceptance or publication.

No migration is required. Rollback by reverting the fix and redeploying; do not
delete approval/audit records or reset result versions in the database.
