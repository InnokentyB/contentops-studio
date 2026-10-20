# Approved026 executable acceptance matrix

Authority: direct Owner approval of LOCK/QAR/ARCH/RISK recorded by root before this scenario authoring. The design header was copied from the pre-approval proposal; this scenario record does not grant live/public-export authority.

Actual boundary: SDK MCP Client → InMemoryTransport → registered task tools → trusted publication principal → real PostgreSQL. No production credentials. Provider networking forbidden by fetch tripwire and synthetic internal-only Docker network. Fixture data uses generated tenants/users/tasks, never production business IDs.

| Scenario | Executable evidence | Required observation |
|---|---|---|
| Preview | actual MCP preview | No writes, canonical identity, manifest/hash, external_object_only, no body/secret |
| Commit | actual MCP commit with UNKNOWN attempt/claimed work | Manual fact/time canonical milliseconds; current unaccepted edition and full custody unchanged |
| Authority | publisher/writer/planner/researcher, missing principal, demo, revoked Owner, foreign tenant | Specific safe refusal; zero facts/custody changes |
| Object/time | hostile/wrong-provider/ambiguous URLs; local/malformed/future time | Zero fetches, safe reason/correction |
| Retained edition | unretained revision/body rejected | No invented revision acceptance/proof |
| CAS | preview tamper, task drift, expected-fact mismatch | Refusal without changes |
| Replay | exact same key and changed attestation | Same fact/audit/checkpoints; changed payload conflicts |
| Uniqueness | same external object across two concurrent tasks | Exactly one canonical fact authority |
| Rollback | actual PG trigger failures at audit/checkpoint inserts | Fact/projection/audit/custody all roll back |
| Late writer | generic FactService and injected beforeWrite callback | Manual fact retained; callback mutations rolled back |
| Historical custody | blocked connector generation/lease/work/asset + old audit | Entire stored rows preserved |
| Same-task concurrency | simultaneous same key and subsequent replay | One fact authority; no duplicate provenance |
| Correction | fresh digest and explicit reason; old audit retained | Same fact ID, new provenance, exact corrected time |
| Authority locking | controlled audit trigger and competing user/member update | PostgreSQL55P03 until canonical transaction finishes |
| Shared object fence | ordinary FactService after manual confirmation; concurrent ordinary/Owner | No second authority for one object, including VK ru/com aliases |
| Generic work queue | claim/complete/block/release/reschedule × browser_publish/provider_publish after manual fact | Entire prior work/audit rows unchanged; cached claim cannot return retained transport lease authority |
| Ordinary metrics | metric_capture claim/complete after manual confirmation | Existing nontransport queue remains usable |

Root verified no supported immutable retained-revision storage exists. Therefore provided publishedRevision is explicitly refused rather than invented; positive external_object_only remains mandatory. Existing sanctioned retirement rejects fact-bearing tasks before mutation and cannot be claimed as a new generic retirement round-trip. Existing generic/late writer and channel-repair refusals preserve the manual fact; actual fact/get/list MCP readbacks expose its manual origin and unknown edition. Remaining gates: exact-source backend/frontend build, focused broader regressions, independent review, quality gate and explicit Owner UAT.
