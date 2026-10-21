# Repeatable X enrollment — approved owner policy21Oct2026

Direct human decision in Portfolio HQ message01a15df1-71a1-7d30-96b1-915e1e5f317c
explicitly removes lifetime three-issue/one-recovery limits and requires working
repeatable enrollment. This bounded maintenance changes no send permissions.

LOCK: existing owner pair command issues current canonical signed challenges for
the existing installation; expired unused ordinary/recovery challenges are
superseded without deleting their audit or creating a fake installation.
ARCH: project settings unique scope/CAS plus serializable transactions, immutable
issue/request/supersession audit, existing signature and registration boundary.
QAR: at most one active challenge per project/installation; ten new challenges per
owner/project in a sliding15-minute window, precise retry-after; five-minute
challenge and24-hour verified enrollment windows unchanged. Idempotent replay
returns the same unexpired nonce without extending time; expired replay never
revives it. Existing HTTP rate limit also applies. No database migration.
RISK: exact current owner/tenant/snapshot/key/extension/bundle/account checks,
sticky revocation, already-registered/consumed and delivery-history fences remain.
Legacy grants and exhausted lineage stay immutable and do not become authority
for a new request. Recovery phase arguments become explicit read-only obsolete-
flow diagnostics; current owner issues normally with a new request key.

RED scenarios include both actual historical deadlocks, rate expiry/retry-after,
one active challenge, idempotency, old-nonce denial, wrong-scope/revoked/registered
denial. PostgreSQL must prove concurrent one-successor and enrollment/renewal
one-winner with rollback. Required backend build, quality gate, independent
security review, PR/CI, source-bound backup/rollback and health/readback.

Handoff: verify the exact browser/account/draft and direct public-result transport
before issuance. Any technical transfer permission is completed before TTL starts.
Return challenge directly in the operator result immediately; optional SSH file
transfer must never delay copying it. Inspect the exact pending operation before
describing waitingOnApproval. Never treat completed marker as a successful result.
Consume signed no-send promptly, enroll via sole Publisher and read back trust.
No live post is authorized by engineering, issuance, proof or registration.
