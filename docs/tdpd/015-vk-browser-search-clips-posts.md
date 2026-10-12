# VK browser adapter: search, Clips and post verification

Date: 2026-10-12. Status: APPROVED FOR LOCAL IMPLEMENTATION.
Human approval: Innokenty, direct message “Да, погнали!” in this chat on 2026-10-12.
Decision bundle: LOCK-VK-015, QAR-VK-015, ARCH-VK-015, RISK-VK-015, AUT-VK-015.
Owner approved LOCK-VK-015, QAR-VK-015, ARCH-VK-015, RISK-VK-015 and AUT-VK-015 as one package. Live provider restrictions remain binding.

## Goal and operator surface — LOCK-VK-015

The owner needs the existing local VK browser adapter to find relevant public
posts, publish an exact approved Clip, and reliably verify ordinary post delivery.
The operator remains Planner plus the existing local browser worker. This slice
does not add another application or replace the local worker with an API route.

The delivery outcome must demonstrate three distinct capabilities:

1. Search-only jobs return attributable public post text, author, permalink and
   observed publication time, or an explicit coverage/access gap.
2. Clip jobs upload the selected approved MP4 once and create a Planner publication
   fact only after a matching provider result is independently observed.
3. Ordinary post jobs preserve current behavior and prove exact accepted text,
   selected media, target community and provider identity before confirmation.

Engineering verification precedes a separately authorized real-provider smoke
and human UAT. A mock, screenshot, upload allocation or button click is not a
production success claim. Final scenarios, RED and isolated implementation are now authorized.

## Evidence and reconciliation

- Current primary checkout inspected at e17b4b6. The active main implementation
  has the VK worker and API search, but no browser search or live Clip driver.
- Clip commit 3e940f0 / draft PR 65 contains orchestration, confirmation guards and
  an intentionally unverified UI port. Reconcile individual modules against current
  code; do not cherry-pick the entire old implementation without review.
- The pre-sync Connector Host package is preserved in stash@{1}; backup snapshots
  must remain intact. The neighboring draft TDPD-014 concerns VK/Dzen host polling,
  is unapproved and does not authorize this slice. Do not duplicate its daemon work.
- Owner screenshots show search -> all results -> Posts; relevant-first sorting,
  full-text expansion, automatic scroll pagination, Copy link and date-click overlay.
  The overlay adds w=wall-201481058_17893. This identifies a post, not relevance.
- Owner selected relevant-first retrieval plus independent relevance/date filtering.
  A sample recent-first result about diesel is an exclusion example, not a business
  research finding. Ranked discovery cannot prove exhaustive fresh-post coverage.
- Clip screenshots show community selection, file upload, processing, caption,
  cover selection and publication. The clip permalink exists before final publish.
- Owner supplied manual publication evidence for clip-240051152_456239019.
  It is an existing publication, never a fresh job to resend or auto-confirm.
- Its local source is kafka-speaker-full-slide-v4.mp4, 1080x1920, 53.37 seconds,
  SHA-256 8567bbc15569bd5823a32b8fc91eaaf7e5d134b0dfc46eae9f45cbf9ddb10603.
- Caption destination is Telegram @spherical_analyst and VK club240051152.
  The YouTube-specific invite must not be reused as a VK attribution link.
- Historical UI evidence does not prove a current authenticated session or DOM
  locator contract. The previous Browser Use denial remains binding: no alternate
  process, browser, cookies or undocumented API may circumvent it.

## Functional boundaries

- Explicit job action distinguishes search, ordinary post and Clip. Search never
  receives publication authority and cannot call upload, react, comment or submit.
- Search jobs bind project/channel and allowed query/date window. Retain original
  evidence before topic filtering; expand text where supported, canonicalize wall
  identity, deduplicate, and label missing/ambiguous dates as unknown.
- Infinite scroll is bounded; do not stop on one old ranked result. Return scanned
  counts, stop reason, exclusions and partial coverage. Relevance is separately
  assessed, never inferred from provider inclusion or one matching word.
- Publication binds the accepted revision, caption hash, approved asset ID/hash,
  exact owner release, channel/account and lease. Retired or published tasks fail.
- Start a durable attempt before the first provider-side upload or submit. A crash
  or uncertain outcome after that boundary allows reconciliation only.
- Clip-to-Story distribution is explicit: default off unless the exact job includes
  separate authorization. Other visibility/comment/duet settings are read back.
- Record local byte integrity and provider acknowledgement separately. Do not
  fabricate a provider-reported SHA-256 if the UI exposes none. An unverifiable
  media or identity binding blocks automatic confirmation.
- No evidence may turn the already-published manual Clip into an adapter success.

## Measurable quality requirements — QAR-VK-015

| Requirement | Proposed measurable boundary |
| --- | --- |
| Integrity | At most one provider submission per task/revision/channel; concurrent or restarted workers cannot duplicate it |
| Search capacity | At most 3 queries, 100 unique posts and 10 scroll rounds per job; total deadline 120 seconds; report partial coverage on limit |
| Browser concurrency | One active job per profile; search and publication cannot share simultaneous mutable page state |
| Timeouts | Navigation/individual read operations at most 30 seconds; media processing at most 180 seconds; timeout never becomes success |
| Privacy | Zero tokens, cookies, authorization headers, browser storage or signed upload URLs in returned/persisted evidence; private artifacts 0600, profile 0700 |
| Confirmation | Wrong community, missing caption/media, prepublication link, stale object or uncertain outcome creates zero confirmed facts |
| Compatibility | Existing accepted post and API-search routes remain available with unchanged authorization; browser routing is explicit |
| Verification | Focused acceptance/regression checks, backend/frontend relevant builds and quality:gate pass; per-build TRUN stores errors and skips |

Budgets are proposed operating limits, not measured provider performance.

## Architecture — ARCH-VK-015

Planner owns task revisions, approval, releases, leases, attempts and facts. The
local adapter owns its private profile and browser lifecycle. Reuse the existing
worker/control/UI boundaries; split browser search and Clip UI into focused modules.
Provider UI changes must not require rewriting Planner business authorization.

Use the existing job-file worker entry point first. Do not add a polling daemon,
database migration or credential provisioning to this slice. Any new search-job
handoff must preserve authenticated project and role scope. Publication remains
restricted to its existing Publisher authority. Existing API search does not silently
fall back to browser execution; operators select the browser route explicitly.

Rollback disables the new routes and restores the previous executable. It retains
started attempts, audit history and existing facts. Never reset an uncertain task
to retry merely because code has been rolled back.

## Adversarial/failure review — RISK-VK-015

| Risk | Required control | Remaining uncertainty |
| --- | --- | --- |
| Hostile provider text | Treat search/posts as data; no instructions, links or comments executed | Relevance requires owner UAT |
| Wrong identity/tenant | Project/role checks and exact account readback | Community display name alone is insufficient |
| Duplicate Clip/post | Durable attempt, lease/CAS, freeze uncertain outcomes | Real DB race verification required |
| Draft Clip mistaken for published | Separate processing/allocation from independent publication readback | Date and media acknowledgement still need permitted live evidence |
| Profile leak/asset SSRF | Local profile, approved roots, bounded HTTPS asset retrieval, redaction | Compromised operator OS outside this slice |
| UI drift/challenge | Grounded controls; typed blocker; close sessions | Screenshots do not establish exact DOM |
| Coverage overclaim | Ranked/bounded search explicitly partial, unknown date excluded from fresh evidence | Full platform coverage cannot be promised |
| Policy denial | Stop affected live operation; no alternate transport workaround | Human approval of this bundle cannot remove the denial |

Verdict: CONSTRAINED for local implementation after approval; live smoke BLOCKED
until a permitted verification route and exact release exist.

## Authority — AUT-VK-015

Approval of this bundle authorizes isolated tests and code implementation only.
It does not authorize new posts, duplicate publication of the Kafka Clip, new
credentials, session extraction, or deployment of an unverified capability.
Existing owner approval of a specific post is checked against its current revision;
new smoke publications require separately bound tasks and exact owner release.
The previous site-safety denial cannot be overridden by this approval.

## Human decision

LOCK, QAR, ARCH, RISK and AUT approved by the owner in this chat on 2026-10-12.
Proceed with final scenarios, RED, isolated implementation and per-build TRUN.
Review release readiness separately; human UAT and permitted real-provider verification remain pending.


## Production code release authorization — 2026-10-12

Owner directly requested: “пушим в прод”, fix the eight baseline errors, then
hand the two old VK debts to Portfolio HQ for checking. This authorizes merging
and deploying the verified code with existing live gates intact. It does not
remove the Browser Use denial, supply a verified DOM/evidence collector, or
authorize resending the already published Kafka Clip. Final production health
and real task readback are required before the HQ handoff.
