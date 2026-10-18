# Owned Dzen adapter lifecycle

This source package is not a deployment, session-readiness result, publication
permission or owner UAT. Follow `vk-owned-publication-route.md` for the mandatory
Planner → registered independent adapter route. Existing provider/tool refusals
remain binding. The production registry is held at
`OWNED_DZEN_ACTION_SCOPE_UNRESOLVED` before credential resolution or child startup.
There is no caller flag, transport switch, new clearance service or browser fallback.

## Existing operator command

Use the existing `ba_publish_publication_task` command. Its Dzen operations are
`release`, `publish` and `reconcile`; omitted operation means `publish`. Omitted
`dryRun` means `true` for this owned lifecycle. A preview reads stored canonical
state only and does not check cookies, list provider objects or prove native
readiness. Other providers retain their existing command and authorization rules;
new owned-only fields are rejected before falling through to a legacy executor.

Identity comes from authenticated MCP request context. Local owned Dzen calls
require configured `MCP_PRINCIPAL_USER_ID`; no first owner is inferred. Tenant
membership and owner/publisher capabilities are checked at the execution boundary.
An owner releases; an eligible scoped publisher may execute an existing release.
Actor, cookie, receipt, transport and permission arguments are rejected by schema.

| Operation | Required data for a mutating call | Meaning |
| --- | --- | --- |
| release | `projectId`, `taskId`, `dryRun:false`, `idempotencyKey`, `expectedAcceptedRevision`, `expectedPackageSha256`, `expectedManifestChecksum`, `approvalReference` | Owner-approved exact package becomes one immutable release/work item/job. No attempt or provider action is created. |
| publish | same exact revision/package/manifest fields and `idempotencyKey`, without `approvalReference` | Current release and full native absence inventory must pass before one claim; start and single-use Submit precede their corresponding effects. |
| reconcile | `projectId`, `taskId`, `dryRun:false`, original `attemptId` and original `idempotencyKey`, without `approvalReference` | Retained receipt completion or same-object readback of the original claim; no new release/job/attempt/send. |

Before release, preview **operation release with the actual authorized approval
reference**. The digest includes that approval binding. Reuse the returned exact
revision/package/manifest fields; a publish preview without an existing release
is not the digest of a later approval. Never invent an approval reference or
silently update a manifest/asset/revision binding to make an old package pass.
Release and execution keys belong to their original operations. After a claim or
uncertain result, another key is never a retry mechanism.

Results distinguish `preview`, `released`, `published`, `blocked` and
`verification_required`. `retry_allowed:false` is deliberate. A receipt, job ACK,
healthy process or empty inventory is not canonical publication. Success requires
strict original-claim receipt custody followed by atomic fact/attempt/job/audit
completion. A DB-only retained-receipt completion may be possible while native
access remains held; it cannot grant permission for a new provider read or send.

The background dispatcher delegates before its old Dzen claim/status/fallback
writes. Without authenticated context and exact owner intent it cannot infer a
live operation. This package starts no scheduler or persistent consumer.

## Preservation and recovery

Release/claim histories fence edits, import/full-sync removal, preparation,
week repair, generic/manual facts, REST content/image operations and automatic
visual re-acceptance. Selected asset and accepted revision remain protected.
Positive generic approval rolls back in its original transaction if it would
change an owned task. Existing explicit audited blocking/revocation controls
remain separate from positive replacement. Removing a mutable status/quality
marker cannot remove durable ownership. Legacy uncertain markers and attempts
also deny fresh admission, including top-level `provider_result_uncertain`.

A saved receipt binds the original attempt/key/generation/account/object/package
and accepted body/asset/title. Current owner, manifest or eligibility drift does
not erase custody; it can hold canonical completion for reconciliation. Multiple
or missing histories freeze rather than selecting a convenient latest attempt.
Receipt serialization retries are DB-only and bounded; a storage outage never
causes another provider call or a claim of evidence durability.

No schema migration is introduced. New jobs have versioned
`owned_provider_v1` JSON bindings. Legacy VK selection excludes those jobs before
its decoder runs; missing-protocol historical VK jobs keep their existing decoder.
Rollback must preserve all releases, jobs, leases, attempts, receipts and facts.
An older build that cannot understand a retained protocol must remain held; do not
reset rows, remove volumes or reactivate an old sender to make rollback proceed.

## Offline engineering commands

All project execution uses Docker on tower-linux; no Mac Docker or host Node.
Build with `ops/quality/compose.yaml --profile build build build-check`. The
read-only image builds backend/frontend and the existing standalone connector;
only temporary logs and connector build output are writable for regressions.
Run `quality:gate` from the mounted `/workspace` with a verified base reference.

For actual synthetic PostgreSQL scenarios, combine
`ops/publication-tests/compose.yaml` with
`tests/fixtures/owned-publication-store.compose.yaml`, use a project-specific
Compose name and set `OWNED_PUBLICATION_TEST_IMAGE` to the reviewed built image.
The runner pushes schema only to its isolated synthetic database and executes
`owned-publication-lifecycle.test.cjs`. Stop with the same Compose files/name and
`down`; never use `down -v` or touch production data.

The separate real Chromium fixture, exact cached-image identity, sandbox probe,
resource limits, health/log/stop commands and denial boundary are documented in
`ops/owned-publication-tests/README.md`. It has no provider credentials or external
network. Its private composition root is unavailable to production registration.
Owner UAT, supported production runtime, applicable native-action permission and
sole-sender cutover remain explicit gates after engineering review.
