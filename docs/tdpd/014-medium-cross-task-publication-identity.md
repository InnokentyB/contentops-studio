# Medium cross-task publication identity guard

Status: `LOCK/QAR/ARCH/RISK owner-directed 2026-10-11; implementation in progress`

## Problem and operator boundary

Two independent Planner tasks published the same normalized article body to the
same Medium profile. Existing idempotency and fact uniqueness were task-local.
The operator boundary is every transition that can make a Medium body eligible
for publication: Writer completion, editorial acceptance, release preparation or
execution, and canonical publication-fact recording.

Historical publication facts are evidence and remain immutable. This change does
not delete Medium content, rewrite facts, call a provider, or publish anything.

## Specification lock

For Medium, the canonical identity is:

`project_id + canonical_profile + sha256(normalize(body))`

`normalize(body)` converts CRLF/CR line endings to LF, applies Unicode NFC, and
removes terminal whitespace. It does not change the stored publication body.

The first task crossing a guarded boundary owns the canonical claim. A different
task with the same identity is rejected with
`DUPLICATE_PUBLICATION_CANDIDATE`, including the prior task/fact/permalink when
known. A different Medium profile is a different identity.

An intentional republication requires a separate owner-only authorization tied
to an existing published fact, the exact target task, canonical profile, body
hash, reason, actor, and idempotency key. The authorization is an immutable
workflow event; it never publishes and never creates or changes a fact.

Structured source lineage is persisted with the identity claim. Medium content
without at least one structured source reference fails closed before it can
advance through a guarded boundary.

Counts representing unique published content deduplicate by canonical identity;
intentional republications remain facts but do not increase the unique-content
count.

## Quality attributes

- Atomicity: concurrent claims for one canonical identity produce one owner.
- Tenant isolation: all reads, claims, overrides, and errors are project-scoped.
- Auditability: override authorization records exact before/after evidence.
- Compatibility: non-Medium channels and historical facts are unchanged.
- Safety: guard failures occur before provider dispatch or fact mutation.
- Privacy: claims contain hashes and normalized profile identity, never channel
  credentials, cookies, tokens, or provider payload secrets.

## Architecture and rollback

A `publication_identity_claims` table owns the concurrency constraint. A focused
domain service derives identities, resolves legacy published matches, enforces
owner overrides, and is called from each boundary. The migration only adds a
table and indexes; it does not backfill or mutate existing content/facts. Rollback
is removal of the boundary calls followed by dropping the new table. Existing
publication rows are unaffected in either direction.

## Risk review

- A missing/ambiguous Medium profile or unstructured lineage fails closed.
- A unique-index race is returned as a duplicate, never retried as a publish.
- The override cannot target an unpublished prior task or a changed target body.
- Historical 1037/1053 remain visible as two facts but collapse to one unique
  content identity in read-only counting.
- Provider execution remains outside this feature and is mocked in tests.

## Acceptance scenarios

1. LF/CRLF and terminal whitespace produce the same body hash.
2. Same profile/body across tasks or initiatives is rejected at every boundary.
3. The same body on a different Medium profile is allowed.
4. A valid audited owner authorization permits a deliberate republication.
5. Two concurrent claims leave one canonical owner.
6. Publication facts and provider calls are untouched on guard failure.
7. Unique-content count does not count duplicate facts twice.

Owner UAT remains required after engineering verification.
