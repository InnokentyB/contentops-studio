# Publication card method selector — approval draft

Status: LOCK / QAR / ARCH / RISK approved by owner on 2026-10-13: «Давай, делай».
Engineering delivery in progress; owner UAT pending.
Source: owner request on 2026-10-13 to switch publication methods in the card.
Surface: existing PublicationTasks card, Publication panel. No redesign.

## LOCK-018: operator outcome and scope

The operator can distinguish connected-adapter execution from recording a real
publication result without mistaking a selected success value for execution.

Place a labelled two-option selector above the panel controls:

- Through adapter: show execution readiness, its blocker, and the existing
  publish action only when the supported route is executable.
- Record existing publication: show the existing permalink/evidence/outcome
  form and its Record publication fact action. This option never sends a post.

Changing the selector only changes the displayed action panel. It does not
publish, enqueue, resume, create another job, modify publication_mode/status,
reapprove content, alter a release, or declare success. It is a presentation
selection, not a change to the provider route. On task change, reset selection
to its capability-based default; no persistent preference in this first slice.

For VK the adapter view means only Planner -> registered independent adapter.
No API/Codex-browser alternatives appear. The existing pilot job is inspected
through authorized Planner readers. A blocked job shows its genuine reason;
the selector cannot clear PROVIDER_PERMISSION_UNVERIFIED. Do not wire the
generic publish-now endpoint to VK or add owner-resume in this slice.

The record view is for an already-existing real result, retaining canonical
fact validation and audit. It is not an alternate agent execution route.
Published tasks show their fact and existing correction workflow; active adapter jobs (including blocked), and cancelled jobs with started
attempts, must not receive a competing generic fact write. Internal canonical
confirmation keeps its existing transaction fence.

The VK pilot scope remains project10/task1048/channel117 and its existing job.
Other VK tasks display unsupported/not configured, never invented readiness.
Other channels retain their currently supported direct-adapter controls.

## QAR-018: measurable acceptance constraints

- Switching panels produces zero publication/task/job write requests.
- Readiness failures and stale/unavailable reads never enable send or say success.
- Cross-project status reads return no task/job information; mutation permissions
  and canonical fact validation remain enforced on the server.
- One keyboard-accessible selector, visible focus, associated label, Russian and
  English text. Both views fit at 375 px and desktop widths without clipping.
- At most one primary business action per selected panel. A heartbeat labelled
  online must be presented separately from readiness to publish.
- No new secrets, browser access, API fallback, migration, or background polling.

## ARCH-018: proposed implementation boundary

Extract a typed PublicationMethodPanel component and capability/readiness helper
from the oversized PublicationTasks page. Keep incumbent styles and canonical
fact controls; avoid materially extending its 2700+ line implementation.

Add a project-scoped, read-only HTTP status bridge for the VK pilot using the
existing dispatch service's status/health readers. Resolve authenticated owner,
task/channel/project/job binding on the server. Client cannot supply arbitrary
actor/host/job scope. Return only allowlisted stage, blocker, attempt/fact/link,
heartbeat observation time and capability; never raw payloads or credentials.
Expose the same canonical job, not a second status store or duplicate queue.

Existing non-VK publish-now and fact APIs remain the owning write paths. The VK
pilot retains operator-only activation until a separately approved control/UI
slice and provider verification are available. No publication_mode rewrite:
current package and execution validation require browser_required and changing
it would invalidate the released pilot.

## RISK-018: failure, compatibility and rollback

- Stale job/health: label unavailable/stale and disable execution.
- Uncertain/started attempt: reconciliation required, no resend or competing fact.
- Unsupported channel/task: explain unavailable capability; no default route.
- Manual record: label it explicitly as recording, retain evidence validation.
- Tenant substitution: derive identity from existing authenticated project context.
- Rollback: remove the view/status bridge; no state or schema migration to undo.

## Next gated work

Following explicit owner approval of LOCK/QAR/ARCH/RISK, write failing operator-boundary
acceptance tests first, including no write on selection, blocker visibility,
tenant isolation, and uncertain/published states. Then implement and run focused
tests, quality:gate, relevant backend/frontend builds, and owner UAT.

This draft does not claim engineering completion, deployment or live VK success.

## Implemented read contract and delivery evidence

GET `/api/publication-tasks/:id/adapter-status` uses the authenticated request's
project/user and the server-resolved task/channel/job. It accepts no client
actor, host or job selection. Response: supported, canExecute (false for this
pilot), manualRecordAllowed, state, blocker, connection, heartbeatAt, publicUrl,
and observedAt. Errors are fixed AUTH_REQUIRED / INVALID_TASK_ID /
PUBLICATION_TASK_NOT_FOUND / ADAPTER_STATUS_UNAVAILABLE; no raw provider payload.
This endpoint reads the owning state only. It never queues, resumes or executes.

The selector is keyed by project/task and resets on task changes. VK status reads
must be fresh (30 seconds) for manual recording; active pilot jobs also reject
competing generic fact writes on the server, including caller-labelled automatic
writes. Internal canonical confirmations retain their private transaction fence.

RED: two card scenarios failed for the absent selector. GREEN: seven local-browser
scenarios, 1077 backend tests after main synchronization, frontend/backend builds,
UI contracts and quality gate passed. Per-run errors and limitations are retained
in docs/evidence/publication-method-selector-trun-2026-10-13.json. Browser tests use
mocked APIs; they are not provider UAT. No production provider operation occurred.

Operator UAT: open #1048, switch both panels, refresh state, confirm its blocker
is visible and switching never submits a post. Then inspect a supported non-VK
card for its existing explicit publish action without sending during UI review.
