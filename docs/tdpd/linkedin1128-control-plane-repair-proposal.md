# LI1128-REL-001 — exact company LinkedIn release repair

Status: APPROVED for LOCK-LI1128/QAR-LI1128/ARCH-LI1128/RISK-LI1128.
Direct human approval in development chat on 2026-10-14: «Да, даю разрешение на
обе задачи», following explicit explanation of issues145/146 and all four gates.
Approval covers this bounded implementation/deployment, not development sending.

## Problem and evidence

Seturon Publisher cannot execute the owner-approved 14 October slot because no
task1128 audited owner-release command exists in its scoped profile. Prepared
handoff mode is automated although the authoritative channel is manual-only.
Source: p7 Planning metadata handoff 2026-10-14, no provider call; owning Publisher
thread `01a06dbc-7cf1-7d83-8ddd-2a0539f2a3d6`. Implementation owner: ContentOps
Planner development / repository maintainer InnokentyB. Operational owner: p7
Planning `01a06dbc-6687-77e0-a14c-33cde5963961` and owning Seturon Publisher.

Exact package:

- project7/slug seturon/task1128/channel6/account seturon_linkedin_page;
- content/accepted revision1, accepted text;
- body SHA-256 `1bb16f09fc632f0ff18b062cd98b914acdbe849b3e8ea5ebd2483355a8a44452`;
- schedule_at AND publish_at `2026-10-14T10:00:00.000Z` (11:00 Europe/Lisbon);
- active decision305/version1/NO_VISUAL_NEEDED/feed, selected asset/checksum null;
- company97416172 / SETURON S.A., canonical URL linkedin.com/company/seturon/;
- status ready_for_execution, publication_mode approval_required, handoff ready;
- readiness ready, dependencies none; no fact/link/attempt/browser work item;
- manifest `sha256:1df2d9b1349626afc03eb09df4156128ddabaf4de93e1cf531f4d1f8e19c43cd`.

Task-bound human GO reference: Portfolio HQ
`01a041f1-23c2-7092-a53a-4d4141a55a62`, 2026-10-14 instruction
«закрывай все долги на сегодня и потом на завтра», relayed with explicit exact
1128/company97416172 once-only scope. Do not generalize this GO to another task,
company, revised copy, schedule or transport.

## Proposed four approval boundaries

### LOCK-LI1128

Expose proposed `ba_release_linkedin_task1128_browser` for this exact package
only to authenticated owner/Publisher. Server principal replaces caller identity
and tenant; canonical owner membership still mandatory. The command is a
control-plane release only: audit the exact GO, materialize the correct manual
browser handoff and create one revision-bound browser_publish WI. Preserve body,
timestamps, channel, revision, visual decision and asset-null state. No generic
Publisher release authority and no development release, browser, submit or fact.

### QAR-LI1128

Serializable transaction and CAS revalidate exact package and current manifest
before any writes. Validate both timestamps, decision ID/version/state, no asset,
canonical company identity/account/manual-only route, owner membership, GO and
absence of fact/link/attempt/active browser WI. Same idempotency key + arguments
returns the same WI; changed arguments conflict; parallel calls cannot create
two WIs. Any failed guard leaves all rows unchanged. Tests cover stale/raced
identity/package/schedule/decision/manifest, unauthorized actor/tenant, replay,
existing attempt/fact/WI and atomic rollback. Existing backend/full builds,
source-mapped sequential regression and quality gate must pass; no secrets or
provider calls in tests. Human UAT stays separate from engineering GREEN.

### ARCH-LI1128

Reuse canonical linkedIn browser owner release service and current remote MCP
registration/identity/allowlist patterns, analogous to task1076/1090, with a
bounded exact1128 wrapper. No parallel queue, new provider/API route, schema
migration, global approval bypass or duplicate sender. Correct the task-bound
handoff projection atomically inside release; future prepare must preserve that
authoritative manual route rather than overwrite it with automated mode.
CAS and audit bind the canonical company identity, not a caller-supplied ID.
Existing Publisher lease/beforeSubmit/uncertain-freeze/reconcile lifecycle stays
in force; release must not create a delivery attempt. No new attempt until the
owning Publisher's actual beforeSubmit boundary; uncertain outcome never retries.

### RISK-LI1128

Public company publication is high reliance/externally hard to reverse. Stop on
missing canonical company identity, unclear manual transport, any active/uncertain
attempt or fact, lease/WI conflict, stale approval or tenant drift. Do not use
personal LinkedIn, OAuth/API keys or another company as fallback. If current
stored binding cannot prove company97416172, return identity-unverified and seek
an explicit audited identity-binding decision; do not guess from the URL alias.
Do not clear leases/attempts or reschedule/backdate to recover a missed slot.
No tokens, provider payload secrets or raw config in audit/tests/logs. Dzen/VK
denials, registered adapter policy and their repair issues remain untouched.

## Acceptance / handoff after approval

The owning Publisher discovers only the exact1128 command, invokes its audited
release with current exact metadata/GO/stable key, and reads one manual
handoff/WI for company97416172 and the unchanged rev1 package. Replays reuse it.
No development actor opens LinkedIn or invokes release/send. Delivery proof,
attempt creation, publication fact and permalink belong to the sole Publisher
through the existing governed lifecycle. A missed scheduled time is reported,
not silently changed. Engineering returns tested commit/deployment and actual
control-plane readback, never a fabricated publication success.

Rollback removes the new exact tool/allowlist and bounded code delta without
rewriting task/GO/WI/audit/attempt/fact history. If release already occurred,
owner-controlled hold/reconciliation is required; no destructive cleanup.

## Current gate

Approved for test-first implementation. Canonical stored company binding must
still be established before enabling release. No development provider/browser
calls, production release or send. UAT remains explicit.

## Newly observed identity boundary — owner approved

2026-10-14 authoritative readback: Planner ch6 has account_ref
seturon_linkedin_page, raw_account.url linkedin.com/company/seturon/,
account_type company_page, execution_modes=[manual]. It has NO linkedin_urn,
profile_ref, identity_ref or canonical numeric company ID. Do not create an
OAuth URN to disguise this omission. Registryv36 holds
profile_seturon_linkedin_page.metadata.linkedinCompanyId=97416172,
relationship seturon_linkedin_represents_identity → identity_seturon,
planner_7_publishes_seturon_linkedin → profile_seturon_linkedin_page with
route brand_page and plannerChannelId6. Development read these exact fields
from the governed local Registry snapshot; this is evidence, not an automatic
server identity reader. Planner runtime has no current Registry reader.

Existing audited precedent: ba_bind_task960_linkedin_identity uses task-only
quality_report.identity_binding and preserves the shared channel; it explicitly
records Registry status UNKNOWN. It is exact960-only and cannot be reused for1128.
Existing1072 repair requires an already bound source channel; ch6 lacks that
binding. No available audited company1128 identity primitive exists.

Single bounded proposal: add exact ba_bind_linkedin_task1128_identity preview /
owner-confirmed apply using the same task-only CAS/audit pattern. Write ONLY
task1128 quality_report.identity_binding with profile_ref,
identity_ref, linkedin_company_id97416172, canonical Registry relationship refs,
Registry source/version/evidence reference and task/body/revision/schedule
binding. Mark verification_basis=owner_adopted_registry_binding and
provider_identity_verified=false. No shared channel/token/body/date/visual
changes, release/WI/attempt/fact or provider call from this primitive. Refuse
foreign/stale package, conflicting existing binding, fact/attempt/lease and key
conflict. Release then requires this stored matching audited binding; absent
binding returns LINKEDIN1128_IDENTITY_BINDING_REQUIRED. Registry evidence or
caller URL alone never releases. Actual Publisher still verifies company97416172
and duplicate history before Submit.

This is an explicit adoption of canonical task identity, NOT automatic live
Registry verification or provider proof. Await the human's specific task-only
binding decision before final scenarios/code for this additional primitive.
That decision is now APPROVED: on 2026-10-14 the human replied to the exact
task-only binding question: "Да, разрешаю task-only привязку". This approves
only the described audited binding; it is not provider verification or send
authority. Registry snapshot evidence SHA-256:
f46b588582ee781f3ab0e1f325be307a87cbff00b106106a9bb7eed6d0bc9670.
Initial proposed hardcoded-snapshot guard test was rejected and removed before
implementation: its premise would have confused evidence with server identity.

## Implementation / TRUN 2026-10-14

Exact binding preview/apply now uses authenticated owner membership, a
serializable task-only CAS, current manifest checks before read/write, both
immutable dates, accepted body/revision, decision305v1, manual channel identity,
no publication hold/fact/attempt/active browser work, and audited idempotency.
Binding carries Registryv36 provenance with provider_identity_verified=false
and registry_current_verified=false; no runtime Registry verification is claimed.
No shared channel/credentials or content/visual records are rewritten.

The exact1128 release uses the canonical release transaction and checks the
stored binding against the specific successful binding audit event. Generic
release also enforces this guard for1128, so it cannot bypass the exact tool.
Release writes one revision-bound browser WI and a manual company-page bundle;
prepare keeps the same manual account/company target. It never contacts LinkedIn.

Scenario-level tests cover preview/no writes, adoption/unverified identity,
replay/key conflict, foreign owner/project/channel, dates/revisions/decision
drift, hold/fact/attempt/work, stale manifest before CAS, CAS conflict, audit
failure propagation, caller-forged unaudited binding, generic release bypass,
manual projection and role discovery. Missing implementation and generic bypass
were observed RED before their changes. Latest focused tests: 15 passed.
Full source-mapped suite before the final role assertion: 1095 passed, no skips;
the final focused suite also passed. Full build and quality gate PASS.

Engineering tests are not owner UAT. Production binding/release/claim/send have
NOT been performed by development. Deployment readback and owning Publisher
handoff remain separate; no publication success is claimed. Rollback is code-only
and must preserve any subsequently written binding/audit/release/WI history.

## Existing WI1924 submission lifecycle — implementation slice 2026-10-15

Scope is completion of the already-approved exact1128 manual company-page route,
not a new OAuth/API route. No release, bind or claim is repeated. New exact
owner/Publisher commands: ba_start_linkedin_task1128_browser_submission,
ba_pre_submit_linkedin_task1128_browser_submission,
ba_confirm_linkedin_task1128_browser_submission,
ba_mark_linkedin_task1128_browser_submission_uncertain.

All bind project7/task1128/channel6/rev1/body SHA above/null asset/decision305v1,
both unchanged original dates, task-only company97416172 binding audit, existing
release audit and exact claimed browser WI1924. Caller identity is replaced by
remote MCP principal. Current owner, pinned manifest and unexpired matching lease
are required before start/pre-submit/confirmation. Expired lease is BLOCKED;
this code neither resets it nor claims/recreates work. New author evidence uses
observedCompanyId97416172 plus screenshot SHA and duplicateCheckReference from
the owning Publisher's actual browser readback; it is explicitly NOT server/API
verification. Development never opens or sends to LinkedIn.

Start serializable CAS creates one conservative pending attempt. Any existing
attempt is reconcile-only, including a different key. Pre-submit revalidates the
current package/lease and records the owning author's evidence. Confirmation
requires that pre-submit event, actual public activity URN/permalink/time and
evidence SHA. PublicationFactService.beforeWrite atomically rechecks all guards
and updates the attempt/audit with the canonical fact. Confirmed replay checks
current fact and current owner membership without requiring a historic manifest
to stay current. No backdating, body/date/asset/channel changes, API fallback,
automatic resend or administrative history rewrite.

RED: exact submission capability absent. Focused tests cover role/schema scope,
wrong company/WI/revision/body, invalid URL/object and backdated confirmation.
Transaction mocks cover CAS conflict/no extra work, prior-attempt reconciliation
and lease recheck inside canonical fact before any writes. These mocks are not
real DB concurrency, provider author verification, deployment or owner UAT.
CI includes these contracts with synthetic import-only Telegram configuration.
Independent review and current production catalog readback remain required.
Rollback unregisters these controls while preserving WI1924, binding/release,
pending attempts, audit and facts; an in-flight attempt remains reconcile-only.
