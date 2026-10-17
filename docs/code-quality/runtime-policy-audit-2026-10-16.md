# Planner: task-specific production authority audit

Audit revision: `12025f29ddf51d30e90825caf2d90e09e1045a1b`, 16 October 2026.
Mode: read-only production-code audit plus expressly requested agent instructions
and approved offline developer guard. No provider, production DB, attempt, approval,
release, fact, account, token, deployment or scheduler changes in this audit.

## Decision summary

**Confirmed systemic debt, not just naming.** Ordinary business publications
currently require new production code/deploy in several governed routes.
Task IDs, accepted revisions, identities, dates and package hashes are executable
allowlists, rather than immutable data consumed by a common lifecycle. Renaming
these modules would not solve this. Conversely, removing their checks now would
remove real safety fences: common UNKNOWN/attempt ownership is incomplete.

**Fixed here:** root `AGENTS.md` and `.agents/AGENTS.md` explicitly prohibit new
task-specific production authority while preserving owner/tenant/package/audit/
idempotency controls. The same scoped policy is installed in the primary working
checkout as well as this review branch; unrelated dirty/unmerged work is preserved.
The missing `.agents/rules/code-quality-defaults.md` reference is corrected.
The approved no-new-debt check is implemented in the existing quality gate and
audit CI job, with an exact per-finding baseline and synthetic acceptance tests.

**Not fixed here:** any runtime finding below. No bulk refactor, weakened guard,
new publication capability or migration is authorized by this report. A no-new-
debt gate has its own verified exact human approval in
`../tdpd/runtime-policy-no-new-debt-contract.md`. That approval does not authorize
repairing the runtime findings, publication, deployment or owner UAT.

## Coverage and method

1. Enumerated **all1,327 tracked paths** at the revision above, not only Dzen.
2. Parsed/classified **1,035 text/code files**: 545 operational, 328 tests/fixtures/
   historical migrations, 125 vendored governance files, 27 documentation data,
   three historical ops migrations, three seeds, two locks and two other files.
   JS/TS/TSX use the TypeScript AST, not a text-match-only inventory. JSON/YAML/
   SQL/Prisma/HTML/CSS receive file classification/text review, not TS semantics.
3. Constructed a literal import/export/require/dynamic-import graph from app,
   stdio MCP, remote MCP, publication scheduler, both workers and frontend main:
   **421 statically reachable files**. It includes type-only imports as a safe
   overapproximation; reachability is not a claim that an action was executed.
4. Found **138 task-named operational modules** and **126 unique literal
   task-numbered MCP registrations**, all statically reachable. The candidate
   dataset has3,070 distinct file/rule/value observations:1,078 identifiers,
   802 business literals,491 comparisons,438 command references,176 digests,
   76 dates and nine fixed actors. These are candidates, NOT3,070 verified defects.
5. Manually traced central dispatch/fact/release/repair routes and every provider
   family below; compared shared alternatives, capability registration, frontend
   configuration, worker bootstrap, scripts, data schema, historical migrations
   and test usage. Independent read-only review confirmed the central findings.

Machine-readable evidence:
`runtime-policy-inventory-2026-10-16.json` contains per-file classification/lines,
entry roots,421 import edges,126 registered tool names and every candidate's
file/line/value/count. Counts are at the frozen base, not the newly added report.
No generated `dist`, node_modules, private `.env`, live sessions or untracked
content is treated as the audited canonical runtime.

The other292 tracked paths are separately enumerated in the inventory:245
Markdown, six env examples, three extensionless files, image/font/skill assets,
shell scripts, Dockerfile, TOML, manifest/patch and a schema backup. Shell deploy/
credential-loader scripts, the active Dockerfile/Compose, env key names only,
webmanifest and migration lock were additionally read manually. Binary skill/
image/font payloads were not unpacked or visually audited; the schema backup is
not the active Prisma schema. This is a code/control-flow audit, not asset QA.
The reusable read-only collector is `scripts/audit_runtime_policy.cjs`; invoke
`summary`, `files:N`, `edges:N`, `findings:N`, or `tools`. It never imports the
project source it parses, rejects tracked source symlinks, and does NOT enforce
a baseline/no-new-debt rule. Reproduce the frozen counts at the audited base;
later report/test files legitimately change a current-worktree file count.

### Entry points and enforcement boundaries

- `src/mcp/server.ts:5` and `src/mcp/remote-server.ts:182` instantiate
  `src/mcp/shared.ts:57`; shared.ts:89–93 registers task and release tool suites.
- `src/mcp/tools/release_control_tools.ts:63–81` registers numbered lifecycle,
  release, repair and account-binding families. `src/mcp/capabilities.ts:168`
  onward exposes matching names to the Publisher profile. Auth scope is separate
  and necessary; names appearing in capabilities alone are not an auth bypass.
- `src/routes/api/publication_tasks.routes.ts:360–389` reaches
  `publisher.service.ts:278` → `publishers/publication_dispatcher.ts`.
  `src/publication-scheduler.ts:1` imports that same publisher facade.
- `src/workers/vk_connector_consumer.ts:140` calls a real consumer runtime;
  operational reachability does not prove its provider admission is available.

## Confirmed findings / remediation backlog

Every row is **OPEN / NOT REMEDIATED**. Owners are proposed component owners,
not assertions of an assigned human. Severity denotes code/design consequence;
no live exploit or duplicate publication was attempted or established.

### RP01 — P1: generic stale publication can re-arm browser work

Evidence: `src/services/publishers/publication_dispatcher.ts:704–710` routes a
`publishing` task to `routeToBrowserPublication`; :63–80 rewrites task mode/status
and upserts existing work to `available`, replacing result payload. There is no
durable attempt/lease/fact check in that mutation. `exact_owned_route_guard.ts:8–12`
protects only selected task IDs; VK/Dzen have separate route stops.
Reachable through UI publish-now and scheduler facade, not a fixture.
Consequence: a generic task with an uncertain in-flight submission may lose its
claimed-work/proof boundary and become available again. Static path finding;
actual provider resend was not performed.
Minimum replacement: shared transactional execution-ownership lookup across
attempt/job/lease/fact for ALL tasks; started/UNKNOWN → same-attempt reconciliation.
Owner/backlog: publication lifecycle, **R1 first**. Compatibility: keep exact
guards until equivalent generic negative/race tests pass. Rollback must preserve
claimed work, payload, consumed permits and UNKNOWN; never restore auto-reset.

### RP02 — P1: canonical manual fact ownership is task-indexed

Evidence: `publication_fact.service.ts:134` invokes
`publication_manual_fact_guard.ts:6–16`; four concrete tasks are blocked, and only
task1048 gets active-job inspection. Other tasks with active executions do not
receive that universal ownership check at this boundary. Existing access,
permalink/time and beforeWrite guards still exist; this is not an assertion that
an unauthenticated caller can write a fact.
Consequence: a separate generic manual fact may race governed execution outside
the named set. Minimum: lock tenant/task and require matching execution context
when an attempt/job owns it; keep genuinely manual observations explicitly typed.
Owner/backlog: fact/lifecycle, **R1**. Compatibility/rollback: preserve legitimate
manual workflows and old facts; disable generalized writes rather than clear locks.

### RP03 — P2: duplicated browser lifecycles and compiled release packages

Evidence: `exact_browser_publication_1133_1132.service.ts:9–65` pins personal/
company LinkedIn, Medium and X packages with specific task/channel/revision/hash/
schedule/asset/profile. `linkedin1086_contract.ts:3–13`,
`linkedin1086_guard.ts:23–45`, `linkedin1128_rev3_contract.ts` and
`linkedin1135_browser.ts` add parallel lifecycle implementations.
Reachability: release_control registration, capabilities and shared MCP entries.
Consequence: next ordinary post/revision/account needs new exports/tools/deploy;
guard parity and bug fixes drift. Minimum: common browser lifecycle plus durable
owner-authorized release/package records and provider identity validators.
Owner/backlog: browser lifecycle, **R2** after R1. Keep old names as narrow
compatibility wrappers; historical command identities, attempts and recovery
records remain immutable. Rollback freezes new dispatch, not historical fences.

### RP04 — P1 availability / P2 architecture: Dzen code shipped but action always stops

Evidence: `dzen1002_action_restriction.ts:13–16` unconditionally throws for every
supported operation. It records a refusal concerning opening task1045's article
and explicitly marks task1002 applicability unresolved. Calls precede native
inventory/publish/readback. `dzen1002_runtime_contract.ts:6–13,44–52` hardcodes the
full1002 package/account; `puppeteer/dzen1002_publisher.ts:76–82` fixes DB channel
lookup, and native network validation embeds that account.
Consequence: deployed tool/schema existence cannot prove actual execution;
another package/account requires code. No real refusal is dismissed here.
Minimum: common provider adapter, durable package and an explicitly sourced
action/context restriction decision. If no legitimate resolution mechanism is
available, say BLOCKED; do not invent a clearance API or config permission bit.
Owner/backlog: owning Dzen chat, **R3**. Preserve sourceCall/refusal/audit; no
root browser, session, provider probe or bypass is authorized by this audit.

### RP05 — P2: generic publication tool selects Dzen by task whitelist

Evidence: `mcp/tools/task_publication_tools.ts:17–20,49–51` selects Dzen from an
explicit task set, then Threads by platform, otherwise Telegram. New ordinary
Dzen task is not identified by its current bound channel/capability.
Minimum: tenant/task channel → provider capability → supported lifecycle; a
specific unsupported placement stays blocked with an accurate reason.
Owner/backlog: routing, **R2/R3**. Keep Dzen/VK route policy and exact active
attempt ownership during migration; never make generic transport a fallback.

### RP06 — P2: Threads whitelist and dry-run/live capability disagreement

Evidence: `threads_task_publication.service.ts:8–26,109,146–163` embeds task
packages, channel138, account identity and release IDs. :84–89 can return
`route_executable=true` while `live_publish_supported=false` for another task.
`threads_pending_release.service.ts` extends the table. This service is directly
selected by the generic task tool.
Minimum: one validator for dry-run/live, release package from data, separate
credential/transport/artifact/authority readiness. Owner/backlog: Threads, **R3**.
Compatibility: preserve existing receipts/thread part IDs and uncertainty; do
not route an unsupported chain/image into a text-only handler.

### RP07 — P2: “generic” Threads release remains single-project/NVN

Evidence: `threads_generic_release.service.ts:52` pins project10 and slug
`analystcraft-2`; :117 repeats project restriction; :73–90 accepts only NVN feed.
The tool name is generic but its tenant/artifact support is not.
Minimum: authenticated tenant binding and declared supported artifact kinds;
extend common engine only with tested capabilities. Owner/backlog: Threads,
**R3**. Rollback retains old release records and freezes uncertain work.

### RP08 — P2: VK independent consumer is still one pilot package

Evidence: `vk_connector_contract.ts:3–7`,
`vk_connector_consumer_runtime.ts:13–35` and `vk1048_provider_execution.ts:13–25`
pin host/project1048/channel117/asset130/WI1699/community/account shape. Worker
entry and dispatch/control tools make them operational, not fixture-only data.
`publication_adapter_status.ts:23–27` reports other tasks unsupported.
Minimum: registered adapter/account context + immutable canonical job package;
shared schema validates record bindings, not literals copied from one job.
Owner/backlog: independent VK adapter, **R3**. Keep existing generation/lease,
media acknowledgement and provider receipt checks. No new consumer activation.

### RP09 — P2: default agent-managed VK admission is blocked; operator authority is distinct

Evidence: `vk1048_provider_execution.ts:32–33,61–65` defaults to a constant blocked
result referencing a prior site-safety denial. This describes the default
agent-managed path, not every production entry point. A separate human-operator
port exists: `workers/vk_connector_consumer.ts:145–153` selects `--operator-run`,
then `vk1048_operator_dispatch.ts:43–47` supplies an application-broker admission
after `authorize('wall_read')`. `vk1048_application_broker.ts:12,19` explicitly
limits that authority to the application, not agent/tool-policy clearance.
The operator port is NOT a Codex fallback or permission to bypass a denial.
Offline injection remains test-only. `publication_adapter_status.ts:36` exposes
ACTION_TIME_ADMISSION_UNAVAILABLE on the default path.
Minimum: distinguish actual refusal provenance, execution context and unsupported
capability from connector health; use only a real supported decision source.
Do not invent an external permission service, accept owner/config flags as
clearance, or remove a genuine denial. Owner/backlog: VK policy/adapter, **R3**.
Rollback stays blocked; this audit authorizes no native check or provider action.

### RP10 — P2: Telegram story exceptions compiled into shared transport

Evidence: `telegram_task_publication.service.ts:75–86` binds asset/provenance/hash/
owner quote to task1099; :164 calls `resolveTask1100StoryFrames`.
`telegram_task1100_story_sequence.ts:31–88` embeds three frames/assets/hashes/link
geometry. `publishers/telegram_publisher.ts:15` imports its type.
Minimum: revision-bound story-sequence manifest with approved assets, MIME,
dimensions, timing and native-link validation. Owner/backlog: Telegram, **R3**.
Preserve actual per-frame identities and partial/UNKNOWN outcomes on rollback.

### RP11 — P2: review, metadata and route repairs duplicate ordinary mutations

Evidence: `mcp/shared.ts:118–181` separately registers task1051/task1091/rev4
collision repairs although `mcp/tools/review_handoff_repair_tool.ts:6–16` exposes
a general hash-bound repair. `work_queue/task1071_route_repair.ts:15–35` pins
channel/decision/WI; `personal_publication_language_repair.service.ts:7–14,80`
only repairs two task packages. `publication_metadata_repair.ts:116–135` has an
executable historical958 evidence exception.
Minimum: shared audited preview/apply CAS repair with typed supersession/evidence
records, no reacceptance or silent content change. Owner/backlog: workflow, **R2**.
Historical IDs in immutable records are valid; executable special-case branches
are debt. Preserve decisions/results/leases/provenance; no mass reclassification.

### RP12 — P2: task-only DEV.to binding masks platform catalog drift

Evidence: `devto_task1118_binding.service.ts:100,137–159` provisions one named
profile/task binding; `publication_placement_contract.ts:6,173` supports DEV.to,
while `frontend/src/pages/Settings.tsx:570,1718–1723` omits that platform option.
Minimum: common audited profile/channel binding + shared platform capability
catalog for UI/backend. Owner/backlog: channels/frontend, **R4**. Channel creation
must not grant release/send authority. Preserve existing token custody and facts.

### RP13 — P2: OAuth endpoint is a deliberate hard501 stub

Evidence: `server.ts:151` registers `routes/threads_compliance.routes.ts`; its
callback :39–45 always returns THREADS_OAUTH_EXCHANGE_NOT_IMPLEMENTED after valid
state/owner/channel checks. This is not a provider rejection or expired cookie.
Minimum: encrypted idempotent token exchange, or explicit unsupported setup UX.
Owner/backlog: integrations, **R4**. Keep state/owner validation and signed
deauthorization/data-deletion routes; never persist plaintext to make it work.

### RP14 — P2: operational one-off scripts are not neutral audit records

Evidence: `scripts/resume_dzen999_publisher.js:18–22` invokes one task/key with
optional confirm; `scripts/unlock_post_308.ts:5–8` directly resets one post's
state. Scratch cleanup/recovery scripts similarly remain executable by an
operator, though not server imports. No script was executed in this audit.
Minimum: retire or convert to parameterized protected operator commands with
read-only preview/authorization/attempt guard. Owner/backlog: operations, **R4**.
Keep historical script provenance as non-executable evidence; do not delete DB
history or use these scripts as a publication fallback.

### RP15 — P1/P2 deployment debt: browser sandbox and local Compose are not safe defaults

Evidence: `puppeteer/dzen1002_publisher.ts:97`,
`puppeteer/dzen_readonly_browser.ts:62` and `puppeteer_publisher.service.ts:172`
disable browser sandbox. `docker-compose.yml:13,22` publishes DB/Redis broadly
and lacks workload resource limits; `ops/railway/Dockerfile.planner-mcp:1–16`
has no non-root USER. Existing Compose is not the newly approved tower runtime.
Minimum: reviewed container/runtime boundary with sandbox/non-root/loopback/
resource limits; use owning migration runtime only after application-specific
verification. Owner/backlog: infrastructure, **R4**; do not alter or stop native
services/production sessions here. Actual platform isolation/exploitability was
not tested, so no claim of a demonstrated sandbox escape or public DB exposure.

### RP16 — P2: operator smoke script passes a secret in process arguments

Evidence: `scripts/railway/post-deploy-smoke.sh:5–22` receives an MCP token as a
positional argument and passes it to another process through `--auth-token`.
This is an operator entry, not an application task dispatch; no actual token or
process listing was read. Minimum: existing scoped credential via protected
environment/file-descriptor input, no argv/log persistence. Owner/backlog:
operations, **R4**. Do not rotate/copy credentials or change deployments here.

### RP17 — P2: general owner recovery/control surfaces are compiled campaign packages

Evidence: `owner_publication_controls.service.ts:19–28,87–113` binds campaign task
sets, body digests, project10/channel111/task971/revision3/asset76 into a normal
owner-control class. `owner_targeted_release_operations.ts:28–69` similarly binds
Threads1029 to channel138/revision3/decision212. `mcp/tools/oct10_owner_recovery_tools.ts:73–85`
puts project/task/date literals into reusable tool schemas and imports many
numbered incident-phase modules. These are executable controls, not neutral
immutable audit records. Minimum: common owner/tenant/revision/manifest/CAS
contracts consuming durable approved campaign/incident packages. Owner/backlog:
owner lifecycle/MCP, **R2**; keep genuine owner, idempotency and transaction checks.
Do not conflate recovery approval with approval to add more compiled task cases.

## Does an ordinary new publication require code/deploy?

| Route | Answer at audited revision | Evidence |
|---|---|---|
| Dzen governed publication | Yes for the new exact package/account | RP04–05, fixed spec/package/tool families |
| Personal/company LinkedIn bounded lifecycle | Often yes | RP03, new package/revision/tool variants |
| Threads legacy live route | Yes outside compiled task set | RP06 |
| Threads generic NVN feed, project10 | No for a matching supported data package | RP07; not a general multi-tenant/image/chain replacement |
| VK registered independent consumer | Yes outside pilot1048 | RP08; transport implementation alone does not enable governed execution |
| Telegram supported ordinary feed/story | Generally data-driven, but specific story/video cases still require edits | RP10; no claim every MIME/sequence is supported |
| Medium/X bounded browser release | Yes outside compiled packages | RP03; numbered X release modules are additionally indexed |
| Ordinary review/metadata/profile repair | Inconsistent: general tools exist, exact repair branches remain | RP11–12 |

Provider protocol changes may legitimately need code; a business task ID,
revision/date/hash/account change must not. Capabilities should report unsupported
transport accurately instead of simulating readiness or adding a per-task route.

## Replacement sequence / compatibility / rollback

1. **R1 safety floor:** universal execution-ownership and manual-fact fencing.
   Tests: pending/started/UNKNOWN/expired/missing-response → zero resend and zero
   WI reset; concurrent confirm/reconcile/fact stays atomic. Keep exact guards.
2. **R2 shared lifecycle/repair:** immutable package + release + attempt/permit +
   reconciliation; tenant-owned context and generic audited CAS repair. Existing
   public command names may delegate during deprecation; audit strings do not change.
3. **R3 provider data adapters:** migrate one supported artifact at a time from
   literal package tables to records; provider account/restriction scope remains
   explicit. Existing attempts never rematerialize as new sends.
4. **R4 UX/config/scripts/runtime:** one platform capability catalog, encrypted
   OAuth, retire unsafe one-offs, verify app-specific container execution.
5. Remove each exact baseline exception ONLY after parity tests, compatibility
   readback and explicit owner UAT. Rollback switches new dispatch off while
   preserving immutable records; never re-arms unknown work or rewrites facts.

These are proposed backlog items, not authorized implementation or live tests.

## Provenance established from Git, not reconstructed intent

First-add history inspected with `git log --follow --diff-filter=A`:

- `dzen1002_runtime_contract.ts`: `14874df`,16Oct2026, “Implement task1002 durable
  Planner runtime and receipt reconciliation” (merged by PR165).
- `linkedin1086_contract.ts`: `15a88f1`,15Oct2026, “Add governed LinkedIn1086 release”.
- `exact_owned_route_guard.ts`: `72b7b34`,15Oct2026, “block generic fallback for
  exact owned lifecycle tasks”.
- `vk_connector_contract.ts`: `4921f21`,12Oct2026, governed consumer PR129.
- `threads_generic_release.service.ts`: `f305f19`,15Oct2026, generic release registry.

These establish introductions, not who intended what or whether the owner
requested hardcoding. In particular, the recently shipped1086 recovery is also
included as production debt; its existing approval does not exempt future copies.

## Explicit limits / unresolved verification

- No production data/provider operation or exploit reproduction. Safety findings
  are static control-flow/data-flow findings, not claims of actual duplicates.
- Static graph cannot prove computed module loaders, reflective registries or
  external operator invocation. Type-only edges overapproximate reachability;
  dynamic tool-name templates may undercount literal-registration inventory.
- Not a complete security pentest, supply-chain audit or formal proof of every
  authorization path. No secret values are copied into this report.
-1327 is frozen tracked scope. Primary checkout has unrelated dirty, staged,
  unmerged and untracked packages; they are NOT reset, merged or falsely counted
  as deployed canonical code. Future Dzen-chat changes need delta review.
- Fixtures, seeds, historical migrations, audit JSON and vendored skills are
  classified, not production violations by numeric appearance alone. Production
  importing fixture authority must still be rejected; no such exemption is a
  runtime authorization mechanism.
- CSS/assets/locks and deployment/env examples need role-specific interpretation;
  a TS AST does not understand SQL/YAML execution or prove a container is safe.
- Existing quality score77 is a baseline, not evidence that these structural/
  lifecycle problems are fixed. Gate and audit evidence must stay separate.
- The enforcing gate is a conservative static control, not a proof of every
  semantic business binding. Computed/renamed identifiers, non-import runtime
  loaders and indirect CLI entry points still require semantic review. SQL/
  Prisma/shell/config handlers are explicitly bounded text handlers, not full
  language interpreters. A passing gate does not clear a runtime safety finding.
- Baseline introduction is a reviewed bootstrap only when the trusted parent is
  exactly `12025f29ddf51d30e90825caf2d90e09e1045a1b` and has no baseline. After
  introduction, CI compares against its trusted base and rejects new/increased
  entries. Baseline/CI/scanner edits themselves remain subject to human review;
  this is not a tamper-proof replacement for repository review/protection.

## Verification of this audit/policy change

- Exact human approval verified from the Portfolio OS user message, not inferred
  from another agent's recommendation; source is in the contract packet.
- **35/35 focused scenarios PASS** in the tower Docker stack: six collector and
  29 gate scenarios. RED evidence included initial absent gate, ancestor symlink,
  switch/element/membership/map/short names, ORM/SQL, stale baseline and short X.
  Each observed gap was reproduced before its implementation fix. No test was
  disabled to obtain PASS. Git fixture commits disable signing and hooks.
- Full enforcing `npm run quality:gate`: **PASS77/77**, no hard stops at
  `2026-10-16T20:28:33.994Z`; **7,096 exact static fingerprints across253 files**
  match the baseline. It scans1,000 source/config files,559 operational/reachable,
  in2.0–4.1s, below the15s budget. This is a different,
  stricter fingerprint identity than the frozen3,070 audit observations; counts
  are not directly comparable and are NOT7,096 separately verified bugs.
- Each baseline row has file/line/rule, exact normalized statement-context hash,
  count, reason, proposed owner and R1–R4 removal backlog. Diagnostic/protocol
  references are conservatively retained as candidates, not blanket exemptions
  or execution authority. Removed/reduced debt requires baseline pruning.
- CI now installs the existing static-parser dependencies without app startup,
  runs focused tests and invokes the enforcing gate with the trusted event base.
  No hosted CI result or merge/deploy is claimed until actually observed.
- Independent review: final report correction and all scanner P2 findings closed;
  no remaining actionable P1/P2 in this audit/policy/gate change scope. Runtime
  findings RP01–17 remain OPEN. Review did not execute providers or native tests.
- New tower Docker configuration runs non-root, with no network/ports/secrets,
  read-only root/source, temporary scratch and resource limits; build uses locked
  dependency downloads only. A canceled broad ownership-change layer and one
  Prisma-engine write-permission build error were corrected narrowly; they are
  infrastructure failures, not passing compile evidence. The fresh build then
  **PASSED backend + frontend** as UID1000 (Prisma generate/tsc/tsc-b/Vite).
  Per-run results and executable input hashes are in
  `../tdpd/runtime-policy-no-new-debt-trun.json`; the tower Git checkpoint is a
  synthetic source snapshot, not a falsely claimed production/review commit.
- Earlier backend/frontend build PASS predates the tower verification. Existing
  frontend dependency vulnerabilities and markdown-to-jsx eval warning are not
  claimed fixed. Owner UAT remains pending after engineering checks.
