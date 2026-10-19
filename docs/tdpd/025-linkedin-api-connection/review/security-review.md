# Independent implementation review

Read-only source review during implementation; this document is not production acceptance.

Concrete findings sent to responsible owners:

- Common API fact guard initially treated all transports as Threads but had only a Threads transaction capability. The current shared guard now has provider-bound capabilities, rejects unknown transport/version and competing same-task recovery rows. Persisted holds must remain independent of feature flags.
- API reconciliation initially authorized the snapshot actor rather than the current caller before spending read budget and GET. Current source checks caller Owner and exact snapshot actor/manifest before reserving reads.
- Image initialize receipts initially required current publication authority before persistence. Current source persists the causal image ID first; subsequent upload remains guarded. The real PostgreSQL lifecycle test checks revocation during initialize.
- Generic channel settings could fabricate verified OAuth metadata/ciphertext and erase a real connection on ordinary updates. Assigned narrow fix and real HTTP/PostgreSQL evidence are in `channel-guards.md`.
- OAuth final save initially read membership without locking. OAuth owner reports adding authority row locks in a consistent order before the channel and attempt locks. API owner also added authority locks and is running a deterministic PostgreSQL revocation test.

Legacy execution source inventory requiring closure: `PublicationDispatcher.executeAutomatedPublicationTask`, `processPublicationTaskItem`, `routeToBrowserPublication`; `LegacyPostPublisher.publishDuePosts`, `publishPostNow`, and `resetStuckPublishingPosts`. A low-level helper-only test is insufficient: denied API-owned work must not upload, send, create fallback work or reset an uncertain attempt through these actual entry points. API owner owns these edits/tests.

OAuth test review requested separate TTL expiry, revoked Owner before/during exchange, provider-denial state binding, raw provider rejection redaction, tenant/channel swaps, organization identity/action mismatch and unknown-exchange replay. The initial tests' combined names did not cover all named cases. OAuth owner is adding them.

Media resolver review: exact tenant-owned asset/key/public storage URL, bounded bytes/deadline, no redirects, hash/type/dimensions, no caller URL/local path observed. No additional confirmed resolver defect found in current source. Its real adapter integration and final combined build remain root's validation responsibility.

Root-assigned MCP/media test additions reproduced unsafe primitive output projection: strings smuggled through allowed `status`, `provider_object_id`, readiness and identity keys escaped unchanged. Root replaced the generic primitive loop with typed booleans, fixed enums and bounded provider URNs. Evidence: `mcp-media-red.txt` (13 pass, 1 fail), then `mcp-media-green.txt` (14 pass, network disabled). Actual server-factory tests cover principal wiring, Owner/Publisher/writer visibility, missing principal and forged tenant/actor before service calls. Media additions cover already-aborted zero-fetch, streamed overflow without content-length with cancellation, and actual MIME/dimension mismatch. These tests use source TypeScript inside the existing Docker image; no rebuild or real provider requests.

Existing Threads boundary and recovery source regressions also pass 31/31 with Docker networking disabled: `threads-regression-green.txt`. No fixture weakening was needed for the shared fact guard extension.
