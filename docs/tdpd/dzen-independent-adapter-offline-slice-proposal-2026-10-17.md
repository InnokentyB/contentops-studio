# Dzen independent adapter: next bounded engineering slice

Package: `DZEN-ADAPTER-OFFLINE-001`. Status: **PROPOSED / NOT APPROVED**.
Planning only: no production code, final scenarios, tests, runtime activation,
provider access or canonical task mutations are included in this package.

## Closed stage and source baseline

PR174 merged `5939dfff95d46078c943ad8ef1fa32b6290553a9`; reviewed stage2 record
PR176 merged `0e33252ae3a6a8075e037ada739900b1423b2a3e`; PR172 exact head
`58b8324119108ae94f933d04a78d69e61c6ad0fe` merged
`8748b950d0f4b7c36a7520c69197d8ebae93abf3`. The owner explicitly approved each
merge/admission stage; the final PR172 approval excluded deployment/live actions.

PR172 removes sandbox-disabling launch arguments at the existing inventory and
publisher launch sites, preserves headless defaults, adds two options/cleanup
regressions, and consumes exactly six reviewed baseline identity replacements.
All row metadata and counts remain unchanged. Exact-head independent review:
PASS, no P1/P2. Five CI jobs,56 focused offline tests and backend/frontend builds
passed. No new test run is performed for this planning document.

The merge additionally retains other main changes from PR177; it is not identical
to the PR172 branch tree. A read-only comparison confirmed the two Dzen source
files, baseline, transition authority and transition gate are unchanged from the
approved PR172 head. No deployment or native browser UAT is claimed.

Read-only source anchors at the merged baseline:

| Source | Finding |
| --- | --- |
| `src/services/dzen1002_runtime_production.ts` | Server constructs exact runtime/store/native ports, without generic independent adapter resolution. |
| `src/services/dzen1002_runtime_contract.ts` | Existing schema/package remains fixed to a particular task/account/revision/release; retain as migration debt, do not copy into new code. |
| `src/services/dzen_task1002_route.service.ts` | Manifest validation precedes the unresolved action-scope guard; preflight remains blocked before provider access. |
| `src/services/publishers/publication_dispatcher.ts` | Governed browser route returns the Dzen adapter requirement; preserve it. |
| `src/services/browser_publication_contract.ts`, `browser_publication_native.ts` | Existing common browser path has manual-handoff checks and a separate X native gate. Neither is a general Dzen adapter by adding a provider enum. |
| `docs/operations/vk-owned-publication-route.md` | Planner command → registered independent adapter/consumer → adapter-owned browser; no Codex browser/session/API fallback. |
| `docs/tdpd/dzen-shared-adapter-integration-trace-2026-10-17.md` | Earlier source trace and full remaining lifecycle/receipt/legacy-history obligations. This proposal narrows the next slice, not that eventual obligation. |

## LOCK-DZEN-ADAPTER-OFFLINE-001 — proposed goal and surface

Problem: a green launch-options double does not demonstrate that the required
registered independent adapter can own a sandboxed browser and return bounded
inventory evidence through the Planner boundary. The existing exact route cannot
be advertised as a reusable lifecycle for ordinary new packages.

Next observable outcome: in an isolated tower test container, an authenticated
Planner-bound request resolves a server-registered independent Dzen adapter,
which owns the browser and reads local synthetic published/draft collections.
Two distinct valid package/account fixtures must use the same implementation as
validated data; a foreign tenant must not reach the adapter. This is an offline
integration outcome, not production readiness or permission to send.

Proposed delivery surface: one new reusable Planner command,
`ba_preflight_owned_publication` (proposed, not currently registered), with strict
inputs `projectId`, `taskId`, `expectedAcceptedRevision`,
`expectedManifestChecksum`, and a bounded correlation `requestId`. Actor identity
comes from the authenticated principal, never a caller permission field. Output
is a bounded `blocked`, `incomplete`, or test-root-only `ready_local_fixture`
summary with adapter identity, counts, completion flags and sanitized blocker.
No new task-numbered MCP command is allowed. The live command must not advertise
a READY capability while its provider path is restricted or unverified.
An inventory call is externally read-only; this slice must not modify canonical
tasks, releases, leases, attempts, facts or production registration/session state.
Registration for the offline job is server-owned fixture bootstrap data, never
a caller-supplied transport, executable, URL allowlist, cookie or permission flag.

Real governed entry keeps the recorded action restriction before any browser,
session, network or inventory work. The local integration job exercises the
adapter against a fixture origin through a test-only composition root; production
cannot select that fixture root or use a caller flag to bypass restrictions.
The real capability remains disabled/unavailable while that path is not permitted
and executable. Do not add a synthetic readiness requirement to the old exact
task route merely to make the new integration indispensable.

Non-goals: publication/edit/upload/Submit/readback, send activation, generic
publication lifecycle cutover, new live worker or scheduler, production credential
loading, schema/data migration, historical attempt rewrites, manual confirmation,
provider-policy clearance and deploy. Existing task1002 owner GO is preserved;
it neither activates this new adapter nor resolves a prior tool refusal.

## QAR-DZEN-ADAPTER-OFFLINE-001 — proposed measurable bounds

| Attribute | Proposed threshold and verification obligation |
| --- | --- |
| Isolation | Linux amd64 Docker on tower; UID1000, read-only source/root, cap-drop ALL, no-new-privileges;2CPU/2GiB/256PIDs; no privileged/host network/socket/root mounts. |
| Browser safety | Actual Chromium sandbox protections enabled. If the container cannot start a sandboxed browser, fail and repair the container; never add no-sandbox or weaken the boundary to pass. |
| Network/secrets | No social credentials and zero packets/requests to Dzen or external sites. Fixture origin is container-local; deny every non-fixture request before dispatch. No host-published ports. |
| Input/output | Strict input ≤64KiB; reject unknown permission/transport/session fields. Sanitized evidence ≤64KiB; retain counts, completion flags and digests, never raw cookies/provider payloads or content. |
| Inventory bounds | Explicit completion for both collections; at most50 pages and10000 objects in aggregate. Limit, repeated cursor, missing paging evidence or partial collection yields BLOCKED/incomplete, never proven absence. Protocol completion semantics still need independent evidence before any future real-provider use. |
| Time/cleanup | Inventory total ≤60s; whole integration request ≤90s including startup/cleanup. Browser/child process gone within10s after failure/cancellation. Timeout cannot issue READY or trigger retry/send. |
| State integrity | Zero changes to canonical publication lifecycle tables. Foreign-tenant and denied actions produce zero adapter/browser invocations. Persistent DB fixtures, if required later, must use the separate synthetic DB stack. |
| Repeatability/cost | One bounded temporary job, no persistent instance; --rm cleanup, log rotation10MiB×2 and temporary logs≤16MiB. Health is explicit process result plus sanitized evidence, not heartbeat-as-readiness. |

These are proposed engineering budgets, not claims about measured provider
capacity. Their approval or adjustment is part of this one package decision.

## ARCH-DZEN-ADAPTER-OFFLINE-001 — proposed boundary

Reuse the existing Planner authentication/tenant resolver and current accepted
package/manifest data. Introduce a shared adapter-port contract and server-owned
registration/capability resolution with no business-ID dispatch branches.
Provider protocol code may be Dzen-specific; task/account/revision/asset bindings
remain validated data. Do not loosen scanner fingerprints or expand the baseline
to admit ordinary new packages.

The independently invoked adapter process owns its browser/session. A trusted
server bootstrap chooses the registered implementation; the request cannot
choose a process/endpoint. The first integration uses a private bounded process
boundary inside the temporary container rather than creating a persistent
daemon, new network listener or queue consumer. Separate production process and
session provisioning is a later operator/deployment decision.

The offline fixture composition root is unreachable from production imports or
runtime request dispatch. Test-only origins/packages are not production authority.
Use the existing native inventory extraction where compatible, separating any
task-specific contract from reusable provider parsing. Real source/AST shape and
module-size inspection precede decomposition. No production call is redirected
to a partially implemented adapter in this slice.

No schema migration is proposed. Compatibility boundary: old releases, jobs,
attempts, receipts, workflow events and facts retain their namespace and history.
Future generic send/reconcile integration must first define how it recognizes old
started/UNKNOWN attempts; it must never mint a new claim as a migration shortcut.
Rollback for this offline slice disables its new registration/boundary only; it
must not restore sandbox-disabling options or delete publication state/backups.

## RISK-DZEN-ADAPTER-OFFLINE-001 — proposed challenge and residuals

| Failure/threat | Required control and evidence before GREEN |
| --- | --- |
| Forged actor/tenant or stale accepted package | Principal-bound lookup, current manifest/revision check and zero invocation on rejection; test at the Planner boundary. |
| Forged registration/transport/capability | Resolve trusted server identity before adapter invocation; registration alone grants no session, release or send authority. |
| Fixture seam becomes live bypass | Separate test composition root; production graph cannot import/select it; deny unknown fields and arbitrary endpoint/session input. |
| SSRF, secret/log leak | Reject non-fixture navigation/requests in the offline job; redact/sanitize errors and retain bounded summary evidence only. |
| Browser sandbox unavailable/resource exhaustion | Fail closed, bounded child/browser cleanup and resource limits; no host-native/Mac-Docker fallback or sandbox flags. |
| Partial inventory interpreted as no duplicate | Both collections must have explicit validated end-of-list; uncertain paging/timeout/limits remain incomplete. |
| Existing uncertainty accidentally retried | No publication mutation/dispatch in this slice; preserve original attempt history and all production no-resend guards. |
| Unsupported provider-policy claim | Preserve actual denial provenance and UNKNOWN applicability; no owner flag or offline PASS clears it. |

Residuals: real Dzen markup/session/paging, actual adapter deployment/health,
publication protocol and human/native UAT remain unverified. This packet is a
proposal, not an independent completed risk review. After owner approval, derive
final boundary scenarios and RED tests, obtain execution-readiness, implement the
smallest slice and independently review its results. Do not claim GREEN/UAT from
this prose or the prior sandbox test suite.

## Independent provider-policy question

Actual source: Browser Use call `call_34840360c84440a286f2230a22165d96`, result
`2026-10-11T21:17:42.380Z`, refused opening the published task1045 article
`https://dzen.ru/a/asvdioZFzXeQEO5O`; same-outcome indirect workarounds prohibited.
The local durable scope finding is
`/Users/innokentyb/Documents/Product/PM/evidence/DZEN1045_TO_1002_SCOPE_FINDING_2026-10-16.json`.
The production guard `src/services/dzen1002_action_restriction.ts` retains that
provenance and throws `DZEN1002_ACTION_SCOPE_UNRESOLVED` before live operations.

Task1002 inventory/publish/readback are different proposed outcomes. Their
nonapplicability to the underlying restriction is **UNKNOWN**, not established
by an owner GO, a new adapter, registration, tests or this merge. No blanket Dzen
domain prohibition is asserted. No authoritative scope/clearance API was found
in the prior read-only investigation; this proposal invents no clearance service,
permission flag or policy resolver that can synthesize a grant. Required next
external evidence is authoritative clarification of the original call and these
three intended actions. No experimental provider probe is proposed or authorized.

## Path remaining to Planner-owned send and the one next decision

1. Approve or revise this combined LOCK/QAR/ARCH/RISK package for **offline adapter
   integration only**. This is the only new owner decision requested now.
2. Then define final scenarios and failing tests at the approved Planner boundary;
   implement and verify registration → independent process → sandboxed local
   inventory, with preserved restrictions and independent review.
3. Separately specify/approve reusable publication/receipt/reconciliation and
   legacy-attempt compatibility. Existing exact runtime tests are input evidence,
   not coverage of the missing generic lifecycle. No exact-task production fork.
4. Before any real inventory or send, resolve the policy applicability UNKNOWN
   authoritatively, verify real adapter registration/session/container readiness,
   exact current package/release/manifest, complete inventory and no uncertain
   original attempt. Existing stale/UNKNOWN state must reconcile, never resend.
5. Deployment/activation and permitted production smoke/UAT require their own
   concrete reviewed plan and owner authorization. This offline package grants
   neither; previous merge-only approvals are fully executed and need no repeat.

If the owner approves step1, the next executable action is authoring the final
operator-bound scenarios and RED acceptance tests in a temporary tower container.
Until then, this remains a reviewable proposal; no new implementation is started.
