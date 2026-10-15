# Publication connector reliability proposal

Status: PROPOSED, not approved for implementation. Date: 2026-10-15.
Decision owner: Innokenty. Engineering owner: ContentOps maintainer.
Existing issues145/146 remain separately approved; this proposal does not delay
their bounded fixes or authorize new copy, release, sends or token changes.

## Current identities and routes

Sanitized Planner channel readback on 2026-10-15 distinguishes stored
configuration from provider verification. Nonempty credential fields do not
prove valid tokens, permissions or account identity.

| Binding | Stored configuration | Provider identity and scopes | Expiry and refresh | Next boundary |
| --- | --- | --- | --- | --- |
| p10 ch138 Threads @innokentybo user39421253764155091 | Active; API publish flag; manual and automated modes; encrypted credential field nonempty | Actual token author, granted scopes and readable results unverified in this engineering run | Not exposed by current scoped readback | CODE_MISSING lifecycle addressed in PR151; owning operational identity/history preflight still required |
| p7 ch5 LinkedIn personal innokentyb | Active; browser_required/manual; API publish disabled; credential field nonempty | Personal OAuth request in source asks w_member_social, r_member_postAnalytics, openid, profile, email; these are requested scopes, not observed grants | Current exchange returns only access_token; expiry/refresh metadata not retained by that function | CODE_MISSING safe scoped readiness diagnostic; do not infer owner reauthorization |
| p7 ch6 LinkedIn Seturon company97416172 | Active; company_page; API publish flag but manual-only execution; credential field nonempty | Task1128 Registry adoption is not provider verification; personal login is not Page authority; Page grants unknown | Not exposed by scoped readback | Existing manual lifecycle PR152; separate diagnostic needed before API migration |
| p10 ch164 X @naraHeTc task1113 | Owner explicitly retained existing personal browser route; no paid API | Owning Ops reported live personal profile Innokenty; server-bound live runtime enforcement remains a separate boundary | Browser session only in current approved route | Do not buy credits, add X API, or claim prose tags prove browser context |
| p10 ch116 Dzen task1002 | Fresh task readback: accepted/content rev3, asset151, owner_released, no fact/link | Native diagnostic entry disabled without trusted admission; native end and owned pinned contract unverified | Cookie validity is not established by this task metadata | BLOCKED publication diagnostics until admitted registered adapter proof; External Radar reading is separate |

No provider authentication or publication was executed from development. Costs
for existing Threads/LinkedIn calls are not verified by this metadata; this
proposal authorizes no new paid plan or chargeable X calls.

Dzen publication is not accepted by issue142: current p10 manifest checksum is
`sha256:cc2cc620612463792340ae39c2a815f61d603edad17cd01e49cff6f369a50dc7`,
while the task1002 route pins
`sha256:4bfec7ca8399251c6c8f132a34d9e0952adbf1eef049d29325808cbd9db3975b`.
No automatic rebind is authorized. Source diagnostic admission fails with
ADMISSION_SOURCE_UNAVAILABLE before cookie access; current deployed enablement
was not freshly verified through an admitted operational adapter in this run.
Native-end proof, owned pinned inventory proof and permitted live UAT remain
unconfirmed. Read/search success cannot clear any of these publication gates.

## LOCK proposed functional boundary

Use the existing project roles, canonical tasks, releases, work items, attempts
and facts for a reusable revision-bound lifecycle, instead of adding a new queue
or editor/planner. Separate account readiness, immutable package readiness,
owner release, dispatch, confirmation and reconciliation. Keep platform and
personal/company author bindings explicit. Never equate a configured flag,
tool receipt, HTTP200 or search success with permission or publication.

Add a project-scoped owner/Publisher read-only readiness operation for explicit
channel IDs. Output only configured presence, expected/observed author identity,
required/granted capability names, known expiry, refresh availability, auth/result
readability classification, observation time and one next action. Do not expose
tokens, cookies, headers, provider payloads or complete configs. First rollout
is LinkedIn personal5/Page6 and Threads138; X stays browser-only. Dzen/VK retain
the canonical registered-independent-adapter route and sticky action denials.

CODE_MISSING means a missing implementation/diagnostic, not an OAuth request.
OWNER_OAUTH_ACTION_REQUIRED requires a real authorized diagnostic result, such as
verified expiration or a documented missing grant. The resulting handoff names
the precise existing connect screen, expected identity and requested capability;
it never asks for a token in chat. A provider denial is not bypassed by refreshing
or switching transport.

## QAR proposed measurable requirements

Zero foreign-author, stale-revision or duplicate sends in acceptance scenarios.
At most one active attempt per immutable package. Every possible send has a
durable fence before dispatch; provider success plus worker crash cannot allow
a second send. A timeout after possible acceptance yields reconciliation only.
Canonical confirmation atomically binds attempt, actual provider ID, permalink,
actual timestamp and fact; do not promise provider exactly-once delivery.

Readiness metadata must be no older than 15 minutes before a scheduled slot;
dispatch must recheck identity/package/admission and credential generation within
60 seconds before the external write. A provider diagnostic has a 30-second
overall deadline, bounded pages and no automatic retry on ambiguous mutation.
Expired/denied admission makes zero provider/session calls.

Pilot SLO: at least 95 percent of authorized scheduled packages with valid
dependencies produce either a confirmed fact within five minutes after their
slot or one actionable blocker before the slot, over the first 20 eligible
scheduled packages. Separately report platform outages, owner-pending packages,
late owner GO and insufficient samples; exclusions cannot hide failed sends.
Safety targets are absolute: zero fabricated facts, blind resends or identity
crossings. Blockers discovered at dispatch notify once within 90 seconds.

## ARCH proposed integration and evidence

Readiness is a bounded adapter capability behind existing authenticated
project-role access, not a global token inspector. Author identity, required
scopes and expiry/refresh support come from versioned official provider contracts
and actual authorized readback. A stored capability flag cannot supply a missing
grant. Refresh, where supported, uses an existing encrypted credential store with
generation/CAS fencing; no refresh token or authorization response enters audit.

Reuse canonical PublicationFactService.beforeWrite and serializable attempt
fences. Bind release actor and operation key, package hash/revision/asset,
channel author and manifest. Authenticate durable identical replay without
requiring its historical manifest to remain current; revalidate current fact
before claiming a successful replay. New writes require current package guards.

For X, the owning execution runtime must check the actual live BrowserInfo and
target identity before attempt and Submit. A caller string or stored profile tag
alone is not enforcement. If the existing browser runtime cannot provide that
boundary, keep the route BLOCKED and propose its integration; do not replace the
approved browser route with paid API or claim server verification.

## RISK proposed review and acceptance

Independent review must cover principal/tenant isolation, release transfer,
concurrent requests, stale configuration and lease expiry, refresh races and
crashes between provider acceptance and fact persistence. No transport fallback,
denial bypass, alternate key or administrative deletion of history is allowed.

Required scenarios: success; 401/expired token; 403/missing capability; 429;
timeout after possible acceptance; worker crash before fact; duplicate/concurrent
delivery; wrong author/stale revision; asset failure; token refresh race. Separate
deterministic tests, real isolated DB concurrency, authorized provider checks and
explicit owner UAT. Existing unavailable credentials/admission remain blockers,
not skipped tests counted as GREEN.

Roll out one existing approved package per supported route, then the next 20
eligible scheduled packages; no synthetic public posts are authorized. Pause
new claims on any safety regression. Rollback removes new registrations and
restores the prior held route while preserving all attempts, releases, work,
audit and facts. Pending/uncertain work stays reconcile-only across rollback.

Owner decision requested only for this new LOCK/QAR/ARCH/RISK package, including
the secret-free readiness diagnostic and reusable integration. Existing exact
fixes, original copy and operational GO retain their own approval boundaries.
