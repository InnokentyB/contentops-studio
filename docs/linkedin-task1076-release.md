# Exact LinkedIn task 1076 owner release

`ba_release_linkedin_task1076_browser` exposes the existing owner-release service to the publisher profile for one package only: project 7, task 1076, channel 6, content/accepted revision 1, selected asset 116.

The caller must supply the current body SHA-256, asset SHA-256, scheduled timestamp, manifest checksum, explicit owner approval reference and idempotency key. Authenticated remote identity replaces supplied actor/project identity; the canonical service independently requires owner membership and current accepted/approved readiness, verifies hashes and schedule, and uses the existing transactional CAS and audit event.

This tool only creates the revision-bound browser publication work item. It does not claim, upload, send, or record a publication fact. The assigned Seturon Publisher remains the sole sender. Generic LinkedIn owner release remains unavailable to the publisher profile. Other packages and editorial roles cannot use this exact release.

After deployment, refresh the owning publisher connection to discover the new tool. If client approval rejects it, obtain explicit owner permission; do not use SDK or DB fallback. Rollback removes this tool registration and allowlist entry without changing existing work items or audit history.
