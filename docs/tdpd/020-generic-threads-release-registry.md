# TDPD 020 — Generic Threads release registry

## LOCK

- Surface: project 10 Publisher MCP.
- Scope: accepted, text-only Threads feed tasks with `NO_VISUAL_NEEDED` and no selected asset.
- Owner intent: replace task-number hardcoding with a reusable audited release and one-shot API delivery path.
- Preserved routes: all existing task-specific Threads release and send tools.
- Excluded: images, chains, replies, browser fallback, retry after an uncertain provider outcome, and cross-project release.

## QAR

- An owner can release an arbitrary canonical task by supplying the exact manifest, task, channel, revision, body hash, schedule, identity, placement, and visual expectations.
- Release performs no provider write and records one immutable proof.
- Live delivery requires the matching release proof and a distinct send idempotency key.
- A delivery attempt exists before the first provider write.
- Provider identity, bounded history, exact text, numeric provider ID, permalink, username, and timestamp are verified.
- Any ambiguous provider or readback result leaves the attempt requiring manual confirmation and forbids automatic retry.
- A confirmed replay returns durable proof and never sends again.

## ARCH

- `ba_release_approved_threads_task` owns generic owner release.
- `ba_publish_threads_task` routes to the generic lifecycle only when the complete owner, manifest, approval, release-key, and send-key envelope is present.
- The release service reads canonical Planner state, checks the current workspace manifest, and uses the configured Threads API identity.
- Serializable transactions protect release and attempt claims. Publication facts remain owned by `publicationFactService` so standard checkpoints are created.
- Credentials are held only in the in-process dispatch envelope and are never written to events or returned by MCP.

## RISK

- Duplicate detection is bounded to five complete 100-item history pages. Pagination gaps fail closed.
- A provider call can succeed while readback fails. This is stored as uncertain and requires reconciliation before any retry.
- Existing metadata such as handoff language is not rewritten by this release mechanism; the accepted body and hash are authoritative for delivery.
- The new MCP tool becomes callable only after the Publisher runtime reloads the deployed server catalog.

## AUT

- The owner supplies the exact approval reference and release package.
- Only a current project owner principal can release or send.
- Release and send proofs bind the owner principal, task, manifest, approval reference, and idempotency key.

## ER

- External effect: one Threads text post through `publishVerifiedText` after a durable claim.
- Success evidence: provider object ID, exact readback, canonical permalink and timestamp, delivered attempt, workflow event, publication fact, and measurement checkpoints.
- Failure evidence: a sanitized uncertain event and a pending attempt marked for manual confirmation; no publication fact is created.
