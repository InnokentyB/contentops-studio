# Independent acceptance threat trace — reusable Dzen lifecycle

Date: 2026-10-18. Reviewer: `/root/dzen_runtime_review_retry`.
Package: `DZEN-ADAPTER-LIFECYCLE-001`.
Approved plan commit: `6b06b1c3e057d7f20057f434762c5f132a41177e`.
Plan SHA256: `d00e091cacdf9ffed1801fc0c2c961e9086c63c86dc3e0074db1330cb9bec37e`.
Existing source baseline: `8748b950d0f4b7c36a7520c69197d8ebae93abf3`;
boundary inspection also used the unchanged starting tree at the plan commit.
Owner approval evidence: `docs/evidence/dzen-adapter-lifecycle-owner-approval-2026-10-18.json`.

Status: **INDEPENDENT ACCEPTANCE OBLIGATIONS — NOT IMPLEMENTATION GREEN**.
This document derives threat/edge traces for the implementing team's final
scenarios and RED tests. It is not a replacement implementation, test execution
receipt, new production authorization or acceptance of an integrated diff.
No material contradiction with the approved plan was found in this source review.
The concrete baseline risks below are obligations of the approved implementation,
not newly discovered permission to bypass them. Integrated code review remains
required at an exact implementation head.

## Existing boundaries that require explicit coverage

1. `src/mcp/tools/task_publication_tools.ts:40` routes a legacy Dzen identifier
   set, then Threads, otherwise Telegram. It is not PublicationDispatcher.
   `src/mcp/remote-auth.ts` only overwrites actorId when that argument is present;
   the existing generic publication schema omits it. The new service must receive
   trusted context independently of caller data and reject missing context.
2. `src/services/vk_connector_repository.ts:73-90` decodes job/key/package results
   as strict VK bindings and selects active project jobs before decoding. Dzen
   jobs must not reach this decoder, take its claim path or fill the first page
   of a VK poll. Existing unversioned VK rows retain their interpretation.
3. `src/services/browser_publication_contract.ts`, execution and confirmation
   encode other providers' identity/placement/fact-kind and native-gate rules.
   A Dzen enum extension alone does not supply provider-owned observations,
   immutable receipt persistence, independent IPC or server authentication.
4. `src/services/publication_manual_fact_guard.ts` protects exact1002 and shared
   browser markers, not a future owned-provider aggregate by default. Its generic
   protection must consult durable ownership/history under the common fence;
   removal of a quality-report marker must not restore manual confirmation.
5. `src/services/mcp_publication/helpers.ts:70` currently treats only published
   status/link as immutable. Prepare/content-update paths in `tasks.ts` and
   publication plan import are separate writers. Importer builds replacement
   status/quality data, updates existing items and deletes stale full-sync items;
   existing preservation helpers cannot be assumed to recognize the new owner.
   Week-package repair/rollback must preserve references and cannot reset history.
6. `src/services/dzen1002_runtime_store.ts:69` preserves receipt custody against
   the original committed claim independently of current owner/package/manifest.
   Its fact completion has separate eligibility checks. This property must survive
   extraction, including legacy attempts that have no transport job.

These are source references in the inspected baseline; line numbers may move
during implementation. The obligations concern observable boundary behavior,
not matching an implementation's function names or private call sequence.

## Required acceptance traces

Every row requires decisive observations, not just a returned status. Synthetic
provider counters, persisted rows/events, immutable hashes and forbidden-port
sentinels should make unexpected effects visible. Network/session access outside
the isolated fixture must fail the run. Setup failures are not feature RED.

| Trace | Trigger / threat | Required observable evidence |
| --- | --- | --- |
| AR01 principal and operation authority | Actual remote scoping/server entry: missing principal, forged actor, foreign project/task/channel, publisher credential attempting owner release, and background invocation without trusted executor context. | Reject before protected package disclosure, channel decryption, native process/asset/network access or canonical writes. Caller actor cannot replace authenticated identity; no first-owner lookup. Owner membership and operation capability both apply. |
| AR02 one reusable boundary | Two unrelated accepted article packages on distinct valid accounts through the same existing tool; denied/unsupported route through both MCP and dispatcher. | Data-driven resolution, no new task/account branch. A handled, blocked or reconciliation result is terminal before legacy claim/fallback. Non-Dzen contracts remain compatible. |
| AR03 effect matrix | Omitted/true dryRun for all operations; false for release/publish/reconcile; incompatible approval/attempt fields; foreign or stale expected bindings. | Preview performs zero release/job/WI/attempt/provider writes/calls. Publish cannot create inline approval. Reconcile binds original publish key/attempt. Input conflict never silently ignores a supplied security binding. |
| AR04 release identity | Release retry; same release key with changed package; publish key differs from release key; cross-operation key collisions. | One immutable release/job identity; one later original claim key bound to that job. No overwrite of job creation key, refreshed release, second job or replaced package. Generated IDs do not make the package digest self-referential. |
| AR05 queue isolation | Interleave valid new Dzen jobs, legacy unversioned VK jobs, unsupported versions and foreign-provider jobs; put more Dzen jobs than the VK page size ahead of VK. Exercise candidates, status, key/package/id lookup, claim and CAS. | Provider/version filtering before decoding and pagination. No wrong-provider decode/claim/update and no starvation of valid VK. Cross-provider project/key collision is explicit conflict. Unknown versions fail closed without widening strict VK bindings. |
| AR06 aggregate ownership races | Separate PostgreSQL processes: same/different publish keys, different package/revision, generic versus exact wrapper, and legacy importer/prepare/dispatcher writer racing release/start. | At most one committed attempt/start and one consumed Submit per item. Losing transactions roll back jobs/attempts/audit as appropriate and perform zero provider mutation. Serialization retry cannot enclose native work. |
| AR07 immutable dispatch and phase fencing | Drift account, accepted body/title/asset/decision, schedule, role, manifest, lease/generation or adapter instance between inspection, claim, start and final submit; replay a consumed permit or stale process message. | Exact original payload remains immutable. Affected phase is denied before its mutation/Submit, all retained claims freeze, and no new key/lease/expiry reopens send. Phase permission and adapter registration are separate checks. |
| AR08 independent inventory | Published plus draft collections with cursors, repeated cursors, partial data, wrong account, duplicate title/object, unknown terminal shape, 50-page/10000-object/60s boundaries. | Both collections have explicit validated completion and bounded aggregate coverage before absence is usable. HTTP200, list URL, heartbeat or a stored old proof never establish current readiness. A complete later inventory cannot reopen UNKNOWN. |
| AR09 exact native artifact | Wrong account/object, recommendation text containing accepted body, extra/missing primary body, wrong title, inaccessible/transformed/wrong cover, malformed canonical URL, old/future provider time, duplicate/replaced/disabled final control. | No confirmed receipt/fact from missing or substituted observations. Exact primary artifact/object/account/cover proof; publication time belongs to original attempt within approved skew. One verified connected control is clicked once. Public task1045 outcome is not navigated as a diagnostic fallback. |
| AR10 process and IPC provenance | Spoofed child response, old generation/attempt nonce, duplicate result, arbitrary executable/endpoint, oversized/malformed IPC, secret canaries in child stderr/errors, inherited NODE_OPTIONS/NODE_PATH or unrelated secrets. | Only server-registered fixed production root may run; response bound to invocation/package/attempt. Production graph cannot import/select fixture authority ports. Child environment is explicitly minimal; no DB/unrelated credentials or executable-injection configuration. Receipt/output are allowlisted and bounded; no secret/raw payload leakage. |
| AR11 crash and receipt custody | Fault before/after claim/start/Submit; valid native result followed by role/package/manifest/hold drift; receipt transaction failure; receipt committed then fact transaction failure or response loss. | Valid already obtained receipt persists against original immutable claim despite mutable drift. Fact remains separately fenced. DB failure retains prior evidence and reconciliation-only state; never guess a URL/time or resend. Crash after external effect but before receipt remains UNKNOWN, not exactly-once success. |
| AR12 completion and replay | Two concurrent reconciliations, fact commit with lost response, same key/different request, conflicting receipt/fact, current access revoked. | One canonical fact/delivered attempt/completion audit. Idempotent read-only replay of matching committed identity; no extra dispatch. Conflict does not overwrite. Current access is checked separately from server receipt custody. |
| AR13 legacy histories | Exact original release without attempt; old claim with no DeliveryAttempt; pending/started/UNKNOWN; retained receipt/no fact; confirmed fact; conflicting/multiple namespaces. Include legacy attempt with no job. | Recognize validated historical versions as data, never task-specific execution authority. Keep original release/key/attempt/events. Ambiguity freezes. No new release/attempt/job for recovery; only an originally linked existing job may be completed. Stale manifest is a reported conflict, not silent rebind or invented renewal. |
| AR14 writers and bypass | After release, start and receipt, invoke content update, prepare, import/materialization including full-sync omission, week repair/rollback, batch/exact dispatch, generic MCP/REST/manual/import fact and status projections. Repeat after attempted status/quality marker removal. | Durable ownership/history references remain authoritative. No overwrite/deletion/reset creates fresh eligibility; supported metadata operations preserve history or reject safely. Caller confirmationMode=automatic, status=published or missing projection support never supplies internal receipt authority. Test common row-lock races, not just sequential marker checks. |
| AR15 budgets, sandbox and cleanup | Actual local fixture browser/process startup; page creation failure, hung fetch, output flood, browser crash, timeout/cancel during start/Submit/receipt, malicious page requesting off-allowlist traffic. | Actual sandboxed Chromium in the approved bounded Tower runtime; whole invocation <=240s and child/browser termination <=10s after timeout/cancel. Native limits/phase network allowlists apply. No orphan process, persistent session/log/secret or no-sandbox fallback. Cancellation after claim leaves reconciliation-only history. |
| AR16 rollback and regression | Disable new admission or roll back implementation after release/start/receipt; unchanged other providers and previously exact Dzen commands. | Historical state and receipt/reconciliation readers remain usable; no queue replay, data backfill, secret copying, volume deletion or reactivation of old send paths. Required quality/build/provider regressions and exact implementation review still pass before engineering handoff. |

## Trace namespace and final scenario cross-reference

AR01–AR16 are independent acceptance-review axes. DA01–DA27 belong to
`dzen-adapter-lifecycle-scenarios-2026-10-18.md`; the numbers are not interchangeable.
This mapping links obligations, not executed coverage or test acceptance:

| Review trace | Final scenario IDs |
| --- | --- |
| AR01 | DA02, DA03 |
| AR02 | DA05, DA10, DA27 |
| AR03 | DA01, DA04, DA08, DA15 |
| AR04 | DA04, DA08, DA12, DA17 |
| AR05 | DA07 |
| AR06 | DA11, DA12, DA21 |
| AR07 | DA06, DA08, DA12, DA23 |
| AR08 | DA08, DA09, DA10, DA18 |
| AR09 | DA16, DA22, DA24 |
| AR10 | DA10, DA22, DA23, DA24 |
| AR11 | DA13, DA14, DA15, DA25 |
| AR12 | DA15, DA16, DA19 |
| AR13 | DA17, DA18, DA19 |
| AR14 | DA20, DA21 |
| AR15 | DA22, DA23, DA24, DA25 |
| AR16 | DA26, DA27 |

## Unsandboxed dependencies and test-runtime hazards

The approved sandbox correction covered two launch sites, not all Dzen/browser
dependencies. Existing unsandboxed launchers remain at:

- `src/services/puppeteer_publisher.service.ts:169-176`;
- `src/services/dzen_task1045_browser.service.ts:24-26`;
- `src/services/puppeteer/dzen_readonly_browser.ts:62`.

`DzenService` imports the broad legacy graph. Reusing its publication, connection
or reader entry points must not accidentally select these launchers or legacy
screenshots/logging. Pure protocol helpers can be extracted/reused without
inheriting launch/session authority. An import inventory alone does not establish
that an unsafe launcher executes; prove the actual execution graph and its denied
paths. Conversely, successful mocks of Puppeteer launch options do not prove an
actual sandboxed browser starts or remains sandboxed.

`ops/quality/Dockerfile` deliberately sets PUPPETEER_SKIP_DOWNLOAD and its static
check image installs no browser. Its existing PASS is not native runtime evidence.
The local browser integration must use a reviewed pinned browser/runtime build
and only the container-local fixture, with no external Dzen traffic or real
credentials. Missing browser libraries, unavailable user-namespace sandbox,
seccomp incompatibility or non-root/no-new-privileges failure are setup/runtime
blockers, not behavior RED and never grounds to add no-sandbox/privileged/host
access or skip a required test. Resource-bound changes require the approved
architecture-change process where material.

Denied production inventory/publish/readback must be tested with sentinels before
session decryption, asset fetch, process spawn and external I/O. The offline root
must not become a runtime flag that permits live work. Fake/fixture cookie and
payload canaries must remain absent from all structured errors and logs. Native
response schemas, redirects and body/image bounds are untrusted-input controls,
not provider permission or business approval.

## Review and delivery status

### Bounded seccomp compatibility review (2026-10-18, static only)

Reference profile: `ops/x-native-extension/seccomp_profile.json`, SHA256
`cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
Candidate: `ops/owned-publication-tests/seccomp_profile.json`, SHA256
`f922c7c9bfc1ece0b72b244e56dc85756ded002c837fb46054cfd8b275c74b6b`.
Independent structural comparison found exactly one changed rule: the chroot
SCMP_ACT_ALLOW entry removes its includes.caps=[CAP_SYS_CHROOT] condition.
All other rules, syscall names/arguments, defaultAction and architectures match.

This expands syscall reachability; it is not an unchanged seccomp policy. It does
not grant CAP_SYS_CHROOT to the outer container. Linux still requires that
capability in the caller's own user namespace for chroot; a new user namespace
can have its own capabilities without gaining parent-namespace capabilities.
The inherited syscall filter must permit the operation before that kernel
capability check is useful. Sources: [Linux chroot(2)](https://man7.org/linux/man-pages/man2/chroot.2.html),
[user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html).
Seccomp is one layer rather than proof of an entire sandbox; see the
[kernel seccomp documentation](https://docs.kernel.org/userspace-api/seccomp_filter.html).

Constrained verdict: the exact candidate is a normal sandbox-compatibility repair
within the approved offline actual-Chromium/cap-drop-ALL objective, not an outer
capability exception requiring another owner verdict. It is eligible only for
the already-authorized bounded Tower/container-local fixture probe. Do not copy
the X compose SYS_CHROOT cap_add into Dzen. No other syscall/profile change,
unconfined mode, host-policy change, privileged/SYS_ADMIN access or no-sandbox
workaround is covered by this review.

The probe must retain outer CapEff=0 and CapBnd=0, NoNewPrivs=1, Seccomp=2,
UID1000, read-only root/source, network none and the approved resource bounds.
Inspect actual child user-namespace isolation and Chromium's sandbox state;
inner-namespace helper capabilities must not be misreported as outer capabilities
or proof of escape. Existing outer diagnostics and the proposed chroot failure
were supplied by the implementing team, not independently reproduced here.
Missing actual sandbox/namespace evidence or another startup failure remains
BLOCKED; this static verdict does not turn the native suite GREEN. No probe or
native process was executed by the reviewer.

No tests were executed for this document. There is no current integrated code
verdict, RED/GREEN count, native feasibility claim or UAT claim here. Each trace
needs scenario/test IDs and per-build TRUN evidence after the implementing team
finalizes scenarios. The independent implementation review must inspect all
changed seams, subprocess/registry roots, queue selectors, legacy writers and
fact paths at one exact integrated head, not rely on an agent-local test result.

Engineering approval authorizes these offline implementation obligations; it does
not authorize merge/deploy or native Dzen work. Preserve the actual refusal and
unresolved applicability distinction. No scope probe, adapter substitution,
invented clearance service, owner flag or fixture permission seam resolves it.
Production activation, permitted real-path smoke and explicit human UAT remain
separate gates. No additional routine approval is required to perform the already
authorized offline work and tests.


## Integrated source review snapshot — 2026-10-18T11:00:49.209745+00:00

This section supersedes the earlier statement that no integrated source review
has occurred. It is a **WIP / BLOCKED source review**, not engineering GREEN.
Git HEAD is `6b06b1c3e057d7f20057f434762c5f132a41177e`; implementation files remain uncommitted and are being
changed concurrently. The hashes below bind this review to the actual file bytes
read for this snapshot, not to HEAD alone. A final committed-head review is still
required after the fixes. No tests, native browser, provider operation or database
runner were executed by this reviewer. Team-reported intermediate test/build/gate
results are not independently reproduced evidence.

### Closed findings in inspected source

- Aggregate ambiguity: `ownedUniqueHistory` fences original-claim loading,
  readback admission and current completion for generic and legacy origins.
  Immutable receipt custody remains separate from mutable admission.
- Receipt serialization conflict: `saveReceipt` retries only P2034 up to three
  attempts; no provider operation is repeated. Exhaustion returns held storage
  failure through orchestration instead of inventing success.
- Legacy started/pending/link markers: new-admission checks were added, but the
  distinct actual top-level retirement marker remains open below.
- Preflight elapsed time is subtracted from the service's 230-second work budget;
  fact authorization is inside the invocation-scoped guarded transaction.
- Queue filtering precedes strict VK decode on candidates/id/key/package/CAS;
  cross-provider key collision remains explicit.

### Open findings requiring correction and focused verification

1. **P1 — REST aggregate writers bypass durable ownership.**
   `src/routes/api/publication_tasks.routes.ts` content update (line266),
   prepare-handoff (line326), fixer (lines673/691), and image upload (line898)
   have direct writes without the new ownership guard/row lock. They can mutate
   a released/started package while the MCP equivalents reject it. Apply the
   common lock plus durable-history check inside each mutation transaction; use
   an early check before costly provider/storage work and repeat the check before
   writes. Verify actual registered handlers, including a release race.
2. **P1 — actual retirement UNKNOWN flag is still ignored.**
   `publication_retirement.service.ts:349` writes top-level
   `quality_report.provider_result_uncertain`; the new guards inspect a nested
   `retirement.provider_result_uncertain` instead. Add the real top-level flag to
   both fresh-admission and durable writer guards; marker-only/no-attempt history
   must not become a new send. Preserve receipt custody for existing claims.
3. **P2 — default facade changes non-Dzen principal requirements.**
   `task_publication_tools.ts` invokes the owned facade for every provider;
   `publication_owned_route.ts` requires the new ALS principal before classifying
   the channel. Previously usable non-Dzen stdio publication with no newly
   configured principal now fails before legacy routing. Preserve existing
   non-Dzen contracts while requiring trusted identity for owned Dzen; verify the
   registered/default callback rather than an injected owned-port replacement.
4. **P2 — session lookup lacks remaining SQL timeout.**
   `owned_publication_registry.ts:12` uses a raw interactive transaction with
   timeout/maxWait instead of the guarded remaining-budget SQL path. Bound this
   lookup with the same server-side statement timeout and invocation context
   before decryption/spawn; verify stalled lookup cannot outlive the invocation.
5. **P1 — repeated publish HTTP requests consume one durable Submit permit.**
   `dzen_adapter_native_page.ts:36,118` permits repeated same-object publish POST
   requests throughout the submitting phase. A single UI click is insufficient
   against duplicate page requests. Consume the permit synchronously for the
   first matching outgoing request; abort subsequent requests. The implementing
   team already identified this issue; its fix/test are pending in this snapshot.
6. **P2 — startup crash precedes resource custody.**
   Browser launch precedes resource ACK; child SIGKILL/OOM in that window can
   leave a detached browser beyond the cleanup guarantee. The proposed exact
   server-nonce Chrome argument, same-UID/proc/group checks, retained PID start
   time and bounded common cleanup deadline are a compatible repair within the
   approved sandbox/capability boundary. The current source still needs that
   implementation and an actual pre-ACK crash fixture. It must not accept caller
   PID/arguments or widen outer capabilities.

7. **P2 — repeated draft creation is also outside the intended single-object mutation.**
   `dzen_adapter_native_page.ts:32` allows the collection create endpoint repeatedly,
   with POST/PUT/PATCH, even after an object is bound. A malicious page can create
   additional drafts while the final proof only inspects the chosen object.
   Consume one expected-method create request before object binding, then allow
   object writes only for that bound object. Verify duplicate create is aborted.

Dispatcher's terminal dryRun preview cannot perform a send or satisfy native
readiness. Missing background principal correctly rejects rather than inferring
the first owner. This review does not label preview delegation as working
automatic publication; any future effects still require the approved exact
operation bindings and genuine executor context.

The runtime action-denial guard remains unresolved/closed. No review or fixture
result clears it. Merge/deploy, provider action, production smoke and owner UAT
are separate from this engineering source review.

### Snapshot identity

Canonical manifest SHA256: `2a7670b51c761f3e636668a22a24d2642765affaac07c908a020c8078811a45b`. Compute it from the sorted UTF-8
lines `SHA256 + two spaces + repository-relative path + newline` below.

```text
2cef73cae649fe888d058a0b57eb5b4cfee7de225ca5164255dc4fa630239598  src/mcp/publication-principal.ts
bc671e59aa40f3210ffde05f09e70906fc409e88f838547edc38af522ba8cd52  src/mcp/remote-server.ts
f83318887cabf6662d85daae0009a7ad2532d183b821d1edd6f7e266081f0e0a  src/mcp/server.ts
ccfb6fd65840270fad03e489a9d45df8db8b0a371dedf27c2435f8ee35e35ad7  src/mcp/tools/task_publication_tools.ts
31b12e6bdd620b67c1d7d16a6f256cd2a9b17b59b6f702dccdafd0155ab087ee  src/routes/api/publication_tasks.routes.ts
d723addbeb41925e0d6e1252c1fe4bfc875cf56a719d0630dc55a0292c0d9563  src/services/dzen_adapter_native.ts
62561deec3de978fe42eca5ebc06f3e049168c48c641709b41aeae6324f9ab41  src/services/dzen_adapter_native_page.ts
8e7f232735650d5960b3f17b170b7d75eca65418336be33beb591ba0992135ef  src/services/dzen_adapter_proof.ts
b82327612595656775f872bdc9ddc144977c1ace6348fb758a15612f7a5657b8  src/services/dzen_adapter_restriction.ts
762fc3bd2f2b4f8d4a86bd9d69681214fa517e2e9c6bc7b3bf1246bbf97d7060  src/services/mcp_publication/tasks.ts
cbc22b93ae11214594146abe7c3e094da47d3e48095615cdc432ffc492c0d053  src/services/owned_publication_adapter_process.ts
67545cf5d88d454a61ead017429ded097d1b8af83503705a1e7265cab89bbbe3  src/services/owned_publication_adapter_resources.ts
46977abd75c99bf6c635f22f5bcfc05f88cb94def1745b15acc32f594f38680e  src/services/owned_publication_contract.ts
0baf0642931def99f6d6a858dfde4d01af110bbb937c2257aa02dfdee9950731  src/services/owned_publication_guard.ts
e16b33fea05e0e0b99ef92d753268ce73be0b4604ffc874794fe928a07cbf7d2  src/services/owned_publication_invocation.ts
0d7f50faa4a4c0f5afa277be0f6488b66792b3cdad0a2bc9c0f4386df0a6fb5b  src/services/owned_publication_legacy.ts
d6656f4b49187756cf55f2bf709d34971b4e7c3865b80877470bd85b90633a25  src/services/owned_publication_native_child.ts
92011c0d3deaed20bad351e3141687ebacfe5e347c616045d8e715b781accd0f  src/services/owned_publication_native_protocol.ts
50d0c5ce0c8e35c61d4433d80264df5378818d7603f509c21c795d161a4e80c8  src/services/owned_publication_registry.ts
714798752b0cda8384d90635422c302b07c6e09b7cffcd332dd9deaab0c4239b  src/services/owned_publication_service.ts
6b65529639a3c45c132cd918f77712e0cfed697dd6bd8ed0343f0c812125caac  src/services/owned_publication_store.ts
2152741ae183087d452dc4cba61fb409cf45ce5ee9bbf3b66b90b54fa5045806  src/services/owned_publication_store_state.ts
bef6581d3f55d0ac5dfa2a62ce552961380f5d4a7a8ad21abcacbe79f845270d  src/services/project_access.service.ts
439e24439001300a579b625a93856ad0a982e167efea08a22bd56409ba51510e  src/services/publication_adapter_status.ts
da7dd30319994adfd1209bc28ba0c6f99ab36dce73ca4d9306f1398aab7c1034  src/services/publication_fact.service.ts
1d4203e2174dda102a139bacab5222adc2335ec14caa4fd9c517be9230114c72  src/services/publication_manual_fact_guard.ts
83dbd84e8a1274cd4b26a838bd3efb95d2c5a8f9fe37e5d393733b8618653a94  src/services/publication_owned_guard.ts
fdfdaff8906697be864b96e0b7b2c53ceb02bfc0e266141d4840c1846dc9eb99  src/services/publication_owned_route.ts
398e85fd1fa016c40f517e5e1d1780cd7157e8cf120eb45524aae2b8cb396827  src/services/publication_plan/importer.ts
b24e6aef1b2f34221ae125bb708ef2c917cc3a9f735df109dc93ebace5e4477d  src/services/publication_plan/utils.ts
935662c3176506d10b398799fa22637d745bcbfdb30f692afc9d7638cf8cfa58  src/services/publication_provider_queue.ts
a111ce14e397a2ab16d3ccdb12e4761e89afd62cc5295f95c0e4f088e26bd7cb  src/services/publishers/publication_dispatcher.ts
7bb527fbce41de56d8eb5b1948606b442c640781269891ac17e6f25d3a88ef90  src/services/vk_connector_repository.ts
1c058c1ec64eec1d547fc563c68b37687af2558fc0a8b06a241ba476fc479b2e  src/services/week_package_repair.service.ts
```


## Bounded fix review — 2026-10-18T11:05:57.431913+00:00

This later source review closes earlier findings2–7 at the source level for the
following snapshot. The top-level retirement flag is recognized. The default
registered callback now preserves non-Dzen legacy routing without granting Dzen
a principal; supplied scoped identity still fails before metadata on mismatch.
The session lookup uses ownedTransaction. Native interception is context-wide
with service workers blocked. Create and Submit counters consume their permits
synchronously before awaiting network continuation; create is POST-only and
first-response identity is bound before later object writes. Startup fallback
uses the exact server-generated NUL-delimited argument, same UID, constrained
process group, rechecked PID/start time and bounded scan/common cleanup budget.
None of these repairs widens sandbox capabilities or provider authorization.

REST write wrappers are now present in the current file: same-row lock and
durable guard execute in Serializable transactions before canonical writes.
Image service work is still in progress and the wrappers' actual handler/race
results remain for final integrated verification; the earlier REST finding must
not be represented as fully test-closed from this source inspection alone.

**Remaining P2: automatic art-direction backfill mutates held aggregates.**
`art_direction.service.ts:441–459` selects ready_for_execution and publishing
items. `acceptContentRevision:146–170` resets status, visual state and handoff
without ownership fencing. Skip/hold owned histories under the same row lock
before automatic re-accept/backfill writes. This is a concrete maintenance path,
not a reason to blanket-disable deliberate owner rejection/revocation. Positive
new-decision/asset-selection paths require equivalent exact-package preservation;
explicit history-preserving invalidation remains a separate permitted control.

Reviewer executed no tests/native actions. The added actual-browser crash and
duplicate-request fixtures were inspected as source; execution counts remain
team-reported until attached final-run evidence. Exact committed-head closure is
still pending. Snapshot manifest SHA256 `58c134ef3ff6fe742e8671215308bea15446676854498b18f954ef4d1058b4a6`:

```text
383229e392ce623a00ebec93916c828d3805d593dc36032a62f0b23750a5ad49  src/routes/api/publication_tasks.routes.ts
4439a67494f0736d6c5b56f6a608f6c94eda6636abdbdc94811f6901930ade5a  src/services/art_direction.service.ts
ad83f7dd4bcffaaced33e951de2dd19276c376518f1ff3065bc08efd92e7cdfa  src/services/dzen_adapter_native.ts
4afd645600d0e508a4c212789c571dbd5853aa235575233d7be9ff58a05e3c45  src/services/dzen_adapter_native_page.ts
b7811f184e7596592498c3467d836842817f82726910fb4a91723880823483e5  src/services/image_asset.service.ts
7dc7f52901c60a1ff0a1d4f482e342ea23d364daa25f37bb3f649e1d8bee0978  src/services/owned_publication_adapter_process.ts
bffb45f5bd419f9155ac7ad6aaf428fd79c987a7aa45ede89744b5d10a33e1cc  src/services/owned_publication_adapter_resources.ts
2af43ae452a50d9d3cbb067d26ee5af121f24c618af68ce24ce764ec609f976c  src/services/owned_publication_guard.ts
9112585558b3a7c09d2f1b6d126444d76167080deeb42fe32758fa9e9bb9d270  src/services/owned_publication_registry.ts
134ddb142fe0b85d75e9cc9607707bac6205f88488dd8ab01bb113c0785bbdfe  src/services/owned_publication_rest_guard.ts
afc684e54ba6f1a369bec73887bb0c958007b66b530fb2b237e5024dae8e77b2  src/services/publication_owned_guard.ts
3595d82a5a4e88881862521fc2844d13667ef33bac5173363c665bb4cdc834e0  src/services/publication_owned_route.ts
fecbe2bbf9717d35e75acd75844bf0ad9cc40ab3ba0fb42edccc9f445e211899  tests/tdpd/owned-publication-adapter-native.cjs
fa3500183e3ef32b63c0b961b3439887152e385175cebbc36254bfdb691a0e18  tests/tdpd/owned-publication-default-route.test.cjs
```


## Writer integration follow-up — 2026-10-18T11:10:50.344455+00:00

REST transactional guards, atomic image-asset/work-item recording, storage-error
projection, automatic accept/backfill and positive generic approval guards were
reviewed in their integrated source. Earlier automatic-backfill and REST writer
findings are closed at the source level. Explicit generic approval rejection is
unchanged. Guarding legacy image rejection is not itself a new defect: that
method changes selected-asset identity/status rather than merely recording a
history-preserving stop. This review requires neither blanket rejection of owner
revocation nor a new revocation API.

**Remaining P2 — positive art-direction/source replacement seams.**
`art_direction.service.ts:236` submitDecision accepts a leased art-direction work
item and current supplied revision, then supersedes the original active decision
and updates decision version/status without the owned row-lock/history fence.
`attachVisualSource:371` likewise creates a replacement source asset/work item and
changes visual/handoff state; SOURCE_REQUIRED/MANUAL_ASSET_REQUIRED decisions can
already have an approved sourced cover and release. Add the common row lock and
ownership check before these positive replacement writes, with an early check
before storage. Preserve deliberately modeled history-preserving BLOCKED/stop
controls; do not infer permission to replace an owned exact package.

Native normal-path first-create response timing still has three team-reported
failures; native GREEN is not established. A one-shot route.fetch continuation
of the actual intercepted UI create request is compatible with the approved
protocol if the request is identical, redirects/retries are disabled, limits are
enforced and any failure aborts without fallback/continue/repeating the POST.
Only the private fixture root may substitute loopback transport. This is review
of the proposed repair boundary, not confirmation of code or executed success.

No tests were executed by this reviewer. The source remains WIP; final exact
implementation commit verification and final run evidence remain **PENDING**.
No merge/deploy/provider/UAT approval is supplied. Manifest SHA256 `531e70d45fb34c0890ff3bdaab54f1b4a2415d47cdab22e2863d3aca7f6189a9`:

```text
72b534c0e9d3912e25e0da38ced29cfc40519ace5e8a553e6e318b565675c031  src/routes/api/publication_tasks.routes.ts
3e52cdb71013ba7472002838b5e51f3295c69e760fc168c4d25f4b5eba9bdcab  src/services/art_direction.service.ts
cf2fecc4c45159415056845276ee099fe066dbadeb3e5f8736550314b05bad86  src/services/dzen_adapter_native_page.ts
68d2ecd2e2a9df74e99a46698db50ce1c2df304667ef11685a82098b4a4486e6  src/services/image_asset.service.ts
ae9674a5c982b7f81d9339d1f30d597f47b3ca4f9352d0c7d693ae0839edc865  src/services/owned_publication_rest_guard.ts
ef894d316351fd74c59270512dd46ad804400f3325972fe98ca5704d43e42f60  src/services/visual_storage_incident.service.ts
6b7fc55489a55f0801bcde61380882360592918954e1e80b78ea6184fb114c00  src/services/work_queue.service.ts
41b89ae95b5c5ed4f11819607f32fdcd96ea1d63162f872af6081f94d915945f  tests/tdpd/owned-publication-lifecycle.test.cjs
```


## Final-candidate boundary review — 2026-10-18T11:22:00.978003+00:00

The positive art-direction/source replacement finding is closed in source:
submitDecision locks the owned row and fences positive decisions while retaining
explicit BLOCKED; attachVisualSource has early and transactional checks. The
approval postcondition in recordWorkflowEvent reads the actual nested decision
field and tenant-owned work-item link inside the original transaction, preserving
rollback of preceding writes. No new open writer finding is asserted here.

**Open P1 — stale proof across awaited Submit ACK.** In
`dzen_adapter_native_page.ts`, the last verifiedPrimary check occurs before
await hooks.beforeSubmit. Editing/autosave remains allowed during that await, so
the provider can persist changed content and the later click can publish it.
Post-Submit fresh readback can detect an incorrect effect but cannot prevent it.
After ACK enter a read-only verification phase that denies all writes, including
publish. Freshly reload the exact bound object; reverify body/title/cover from
fresh primary state, reopen the dialog and reacquire/revalidate its unique
connected control. Arm the one-shot Submit request only immediately before
click. Rechecking old DOM alone is insufficient. Add a deterministic during-hook
autosave/provider-body drift case requiring zero publish requests and held
original history, plus the normal one-Submit case.

This is an actual phase-order defect, not a demand for a universal provider CAS
or proof against unrelated concurrent external clients. The scope is the
adapter's own editing requests across its awaited database fence. Native final
suite evidence and exact implementation commit closure remain pending. Reviewer
ran no tests/native actions. Snapshot SHA256
`5a35c80f8d17895e4ec1d3f1dec317ef1882586516d450d1bd18aff7385592c2`:

```text
2dc7b6fa0453169950fc4d51f4426aee6449389f393c1e695245f5446cb53b7d  src/services/art_direction.service.ts
46e0677b7e2b3c71d6665e4b4f573baa7d4d7b6d76aa8dfe05593bfe7eb19a2a  src/services/dzen_adapter_native_page.ts
3637932815dfc05eed5a46f3494a8a26004ff5c2f2a1d6a3125f7f467178d24a  src/services/work_queue.service.ts
70cba63f7165c820e5a87b94a5d42dc9badd0ba1fa42776df9f2ca3d3f89311f  src/services/work_queue/infrastructure.ts
```


## Post-ACK proof follow-up — 2026-10-18T11:25:02.875741+00:00

Reviewed native page SHA256 `2281c4977346acbe9998c6666f3fd4344f1fbe3868be9095e07dd2fa7018e2f8`. OAR11's earlier awaited-hook drift
finding is closed in source: ACK now enters verification with all writes denied,
freshly reloads/revalidates the exact object and reacquires the final control
before arming one Submit request. Reviewer did not execute its tests.

**Remaining P1 — admitted editing requests can outlive fresh proof.**
The editing route calls fallback without tracking request completion. An
already-admitted autosave can remain at the provider across the verification
cutoff and fresh reload/proof, then commit changed body immediately before
publish. Denying only newly arriving writes does not cancel or drain it.
Track each editing mutation synchronously before forwarding; after switching to
verification, drain all admitted mutations before reload. Bound the drain by the
shared deadline; failure, unknown completion or timeout must abort publication.
Do not treat client cancellation/requestfailed as absence of a server effect.
A delayed-own-autosave fixture must prove the adapter waits, observes persisted
drift and makes zero publish requests. This concerns only the adapter's own
requests, not a universal cross-client provider CAS. Exact-head review and final
run evidence remain pending.


## Frozen-source closure — 2026-10-18T11:28:55.693679+00:00

**CONSTRAINED SOURCE REVIEW CLOSED: no remaining P0/P1/new P2 identified in
the cumulative reviewed implementation scope.** This latest verdict supersedes
the earlier open findings above, which are retained as review history. It is
not a claim that final tests, owner acceptance or production readiness are done.

The final native page hash is
`e97abe42a11568307e207423177e00750fb582518d109f8bf3ec0de56ef50719`.
All admitted editing POST/PUT/PATCH requests enter the ledger synchronously before
continuation. Only requestfinished removes them; requestfailed/non-success and
subsequent admission fail closed. Verification cutoff occurs before the bounded
15-second/shared-deadline drain, then fresh reload/proof and dialog reacquisition.
This closes the in-flight own-autosave finding in source without demanding an
unavailable universal provider CAS.

The runbook correctly distinguishes stored preview, release, publication and
original-key reconciliation. It preserves the unresolved production action guard,
absence of scheduler/migration/activation, immutable legacy custody and explicit
production-runtime/permission/owner-UAT gates. The quality-baseline change prunes
the two removed fact-service special-comparison debts; this is not new authority
or a debt-widening grant. The test runtime changes remain isolated engineering
configuration, not production credentials or deployment.

Reviewer inspected source/Git/docs only and ran no project/native/database tests.
Team-reported RED/GREEN evidence is not independently executed evidence. The
final compiled-artifact native28 suite/build/quality results and the final exact
committed-head verification are explicitly **PENDING**. No production, merge,
deploy, provider-action or UAT authorization is supplied by this receipt.

Snapshot HEAD `6b06b1c3e057d7f20057f434762c5f132a41177e` still precedes uncommitted implementation.
Manifest covers 48 changed/new production, runtime, CI and runbook files;
review/test/evidence documents are excluded from this manifest to avoid circular
hashing. It pins bytes, not execution. Canonical SHA256 `8cea0b35b8bc7d3b79a4c18493adcf6f627f9734ec8bf31f2b8440bc7fb07321`:

```text
ad8b4291b89a8caf87f8755c2d7ca1a30574611cdf3b36ffa6bec9c9a83da27c  .github/workflows/code-quality.yml
f224cb34efbf538294beda3800aebd16dbd8b45f39af863b8a7df47bb138aa25  docs/code-quality/runtime-policy-baseline.json
726e64a11a9d48dde32e6b1f46ac1e3670c00e1cace3f7b4920a473ae564b6ee  docs/operations/owned-dzen-adapter-lifecycle.md
4a48f23b1d16d11d6f8c6e4b257f487eb8aced4f525ae4f1d1ffc225c6c4f6ca  docs/operations/vk-owned-publication-route.md
929198efb05b533577ad466412ed3bcab6fd9f96dd94775e0852c1647c487e7f  ops/owned-publication-tests/README.md
0330196343b751e394981cad9c60da6d10287d80d2ca14bfead4967f9a17147d  ops/owned-publication-tests/compose.yaml
f922c7c9bfc1ece0b72b244e56dc85756ded002c837fb46054cfd8b275c74b6b  ops/owned-publication-tests/seccomp_profile.json
f92a576f447c75b1fbc4356997004de1d453367e2426c0242389061305665a94  ops/quality/Dockerfile
c9dbea79a742766e4bfb6210582565317839eb15dbf7a7bb7a48fd91c76f70ac  ops/quality/compose.yaml
2cef73cae649fe888d058a0b57eb5b4cfee7de225ca5164255dc4fa630239598  src/mcp/publication-principal.ts
bc671e59aa40f3210ffde05f09e70906fc409e88f838547edc38af522ba8cd52  src/mcp/remote-server.ts
f83318887cabf6662d85daae0009a7ad2532d183b821d1edd6f7e266081f0e0a  src/mcp/server.ts
ccfb6fd65840270fad03e489a9d45df8db8b0a371dedf27c2435f8ee35e35ad7  src/mcp/tools/task_publication_tools.ts
72b534c0e9d3912e25e0da38ced29cfc40519ace5e8a553e6e318b565675c031  src/routes/api/publication_tasks.routes.ts
2dc7b6fa0453169950fc4d51f4426aee6449389f393c1e695245f5446cb53b7d  src/services/art_direction.service.ts
ad83f7dd4bcffaaced33e951de2dd19276c376518f1ff3065bc08efd92e7cdfa  src/services/dzen_adapter_native.ts
e97abe42a11568307e207423177e00750fb582518d109f8bf3ec0de56ef50719  src/services/dzen_adapter_native_page.ts
8e7f232735650d5960b3f17b170b7d75eca65418336be33beb591ba0992135ef  src/services/dzen_adapter_proof.ts
b82327612595656775f872bdc9ddc144977c1ace6348fb758a15612f7a5657b8  src/services/dzen_adapter_restriction.ts
fe542e6aaed89a969f77e4671fb9a9696c7a8c720de1b1711bdb5b6d25a88698  src/services/image_asset.service.ts
762fc3bd2f2b4f8d4a86bd9d69681214fa517e2e9c6bc7b3bf1246bbf97d7060  src/services/mcp_publication/tasks.ts
7dc7f52901c60a1ff0a1d4f482e342ea23d364daa25f37bb3f649e1d8bee0978  src/services/owned_publication_adapter_process.ts
bffb45f5bd419f9155ac7ad6aaf428fd79c987a7aa45ede89744b5d10a33e1cc  src/services/owned_publication_adapter_resources.ts
46977abd75c99bf6c635f22f5bcfc05f88cb94def1745b15acc32f594f38680e  src/services/owned_publication_contract.ts
2af43ae452a50d9d3cbb067d26ee5af121f24c618af68ce24ce764ec609f976c  src/services/owned_publication_guard.ts
e16b33fea05e0e0b99ef92d753268ce73be0b4604ffc874794fe928a07cbf7d2  src/services/owned_publication_invocation.ts
0d7f50faa4a4c0f5afa277be0f6488b66792b3cdad0a2bc9c0f4386df0a6fb5b  src/services/owned_publication_legacy.ts
d6656f4b49187756cf55f2bf709d34971b4e7c3865b80877470bd85b90633a25  src/services/owned_publication_native_child.ts
92011c0d3deaed20bad351e3141687ebacfe5e347c616045d8e715b781accd0f  src/services/owned_publication_native_protocol.ts
9112585558b3a7c09d2f1b6d126444d76167080deeb42fe32758fa9e9bb9d270  src/services/owned_publication_registry.ts
ae9674a5c982b7f81d9339d1f30d597f47b3ca4f9352d0c7d693ae0839edc865  src/services/owned_publication_rest_guard.ts
714798752b0cda8384d90635422c302b07c6e09b7cffcd332dd9deaab0c4239b  src/services/owned_publication_service.ts
6b65529639a3c45c132cd918f77712e0cfed697dd6bd8ed0343f0c812125caac  src/services/owned_publication_store.ts
2152741ae183087d452dc4cba61fb409cf45ce5ee9bbf3b66b90b54fa5045806  src/services/owned_publication_store_state.ts
0c2a4adf172f55cab4a808b9010412baf41e966a1c7455fe2933758aecd007ea  src/services/project_access.service.ts
439e24439001300a579b625a93856ad0a982e167efea08a22bd56409ba51510e  src/services/publication_adapter_status.ts
da7dd30319994adfd1209bc28ba0c6f99ab36dce73ca4d9306f1398aab7c1034  src/services/publication_fact.service.ts
1d4203e2174dda102a139bacab5222adc2335ec14caa4fd9c517be9230114c72  src/services/publication_manual_fact_guard.ts
afc684e54ba6f1a369bec73887bb0c958007b66b530fb2b237e5024dae8e77b2  src/services/publication_owned_guard.ts
3595d82a5a4e88881862521fc2844d13667ef33bac5173363c665bb4cdc834e0  src/services/publication_owned_route.ts
398e85fd1fa016c40f517e5e1d1780cd7157e8cf120eb45524aae2b8cb396827  src/services/publication_plan/importer.ts
b24e6aef1b2f34221ae125bb708ef2c917cc3a9f735df109dc93ebace5e4477d  src/services/publication_plan/utils.ts
935662c3176506d10b398799fa22637d745bcbfdb30f692afc9d7638cf8cfa58  src/services/publication_provider_queue.ts
a111ce14e397a2ab16d3ccdb12e4761e89afd62cc5295f95c0e4f088e26bd7cb  src/services/publishers/publication_dispatcher.ts
ef894d316351fd74c59270512dd46ad804400f3325972fe98ca5704d43e42f60  src/services/visual_storage_incident.service.ts
7bb527fbce41de56d8eb5b1948606b442c640781269891ac17e6f25d3a88ef90  src/services/vk_connector_repository.ts
1c058c1ec64eec1d547fc563c68b37687af2558fc0a8b06a241ba476fc479b2e  src/services/week_package_repair.service.ts
70cba63f7165c820e5a87b94a5d42dc9badd0ba1fa42776df9f2ca3d3f89311f  src/services/work_queue/infrastructure.ts
```


## Exact committed implementation verification — 2026-10-18T11:59:24.044809+00:00

Checked implementation commit
`82382aa134a7029c987479f47bf3c0c7e4d1e575`. **No open P0/P1/new P2** remains
in the cumulative reviewed scope. All48 frozen-source rows byte-match both
that commit and the local source; canonical manifest remains
`8cea0b35b8bc7d3b79a4c18493adcf6f627f9734ec8bf31f2b8440bc7fb07321`.
All48 rows in the separate retained source-manifest JSON also match the commit.
The only later working-tree changes at verification are evidence-index/log-name
corrections; final docs-only parity is still required after the receipt commit.

All26 currently indexed raw artifacts exist and match recorded SHA256/byte size.
The retained final TAP summaries independently read here are parent26, actual
synthetic PostgreSQL41, native28, publication203, Dzen/VK172 and sharedX74, each
with zero failures/skips. Quality JSON reports PASS,7093 matching findings and
baseline rows, no hard stops/applied transitions. Retained final build output
shows the completed backend/frontend/connector image build. These checks inspect
retained evidence: reviewer did not execute the suites or rebuild/reopen the
Docker image.

Native source remains
`e97abe42a11568307e207423177e00750fb582518d109f8bf3ec0de56ef50719`;
the retained source/build record binds image
`507161d2b1e013b7b2640364390a6fdb7bade74635bbee0f63702fb7b0bc3556`,
compiled page
`3e7e7676af130be5adc5ba1ec4db720c974fb71cf0c09224fc5a37205c4f83d1`
and native final TAP
`e5b02ec102daa55975a5cb1c9ab185d57f9a79302a8015047429936df2b90c84`.
The actual native TAP hash was checked; image/compiled hashes were checked for
consistency of retained metadata, not independently extracted from Docker.

Correction to the earlier shorthand baseline statement: exactly THREE rows were
pruned—two fact-service business comparisons and one image-service business
binding replaced by a named protocol constant. Zero rows were added and metadata
of every retained identity is unchanged; no legacy identity remapping occurred.

Verdict: constrained offline engineering source/evidence review closed for this
implementation commit. Final docs-only exact-head parity remains pending. Owner
UAT, production runtime/deployment, native action-scope applicability and
sole-sender cutover remain separate explicit gates. This receipt supplies no
merge/deploy/provider-action or UAT approval.


## Main-sync integration addendum — 2026-10-18T12:25:16.858623+00:00

Checked exact merged-source commit
`2a2b94567bbcdb7a66f0c82ca51942259b123955`, parents
`8f0950e5fe0f8ac7b750d76b59a53210b999d694` and
`17e0aefb1f4195c520f5fa9cb9610d686a1de0d0` (incoming LinkedIn text-only).
**No new P0/P1/P2 integration finding.** The previous cumulative Dzen source
verdict remains valid:47 of the historical48 files remain byte-identical; only
workflow differs. Its resolution preserves owned parent and PostgreSQL checks
and appends the incoming LinkedIn test to the shared suite. All8 other merge
paths exactly match incoming main. No Dzen production/test source changed.

The nine source-delta hashes in
`docs/evidence/dzen-adapter-lifecycle-main-sync-2026-10-18/index.json` all match
committed Git blobs. All5 indexed raw artifacts match SHA256/size. Index SHA256
is `2843b1a0116aab1a9396727e46f0931ce572bfa48824524522548811e582eee9`. Retained focused TAP reports77pass/0fail/0skip; quality
reports PASS,7093 findings/baseline, no hard stops or applied transitions. The
full backend/frontend/connector build output completes and records image
identifier `04f49d5df6bdcc7030599f62bb527bf391acb5aed447926212c484b263f3b868`.
Reviewer checked retained records, not a reopened image or rerun tests.

Missing trusted baseline object and accidental PostgreSQL selection without a
synthetic database are retained and correctly classified as setup failures, not
acceptance RED. Historical native28/PG41 evidence remains bound to unchanged
Dzen bytes; it does not claim the old image contained incoming LinkedIn changes.
The original48-file manifest is intentionally unchanged. This addendum and the
merge index extend it without rewriting historical evidence.

Final docs-only head parity after committing this addendum remains pending.
No test/provider/native/database action was performed by this reviewer. Existing
action denial, deployment/runtime readiness and explicit owner UAT remain
separate; this addendum grants no merge/deploy/live-publication/UAT authority.


## CI setup repair review — 2026-10-18T12:26:04.448030+00:00

Reviewed the four-file repair on source HEAD
`2a2b94567bbcdb7a66f0c82ca51942259b123955`. **No new P0/P1/P2 finding.**
The quality test runner gains only a16MiB nosuid/nodev ephemeral logs tmpfs at
/workspace/logs, matching its read-only mounted source working directory. No
production source, secret, capability or provider permission changes.

The1002 runtime fixture explicitly validates tenant/task/protocol predicates for
new scoped history reads, then still requires the exact1002 refusal. The actual
MCP/REST fact fixture permits transaction-scoped user2/project10 authorization and
read-only history delegates while preserving the forbidden delegate proxy:
publicationFact access and mutations remain unavailable, all lifecycle cases
still require the exact refusal and all12 transactions remain asserted. The
approval-required preparation fixture merely supplies absent history/job reads;
its zero-write sentinel and complete unchanged-task assertions remain intact.
These are fixture/setup compatibility repairs, not relaxation of fact authority.

Reviewer ran no tests. Fresh focused Tower results and subsequent exact
committed-head/evidence verification remain pending; earlier CI setup failures
must remain identified as failures rather than silently replaced with GREEN.
Repair manifest SHA256 `5003aa139616a853e845cbd6f2761c86477eb269fae0c4b55658afe9c2fbcd3c`:

```text
19f38af7849d5249d48b820f9548b3ca793178b5279c4e58792f68ef80122423  ops/quality/compose.yaml
9753dd229107365ad313ad31817011dd7335861854b3ce56f1a2820cb1fd0dc5  src/tests/prepare_approval_guard.test.ts
3d3add27a5e7d50b1ebfa286b986394ea435f1b867c0cdf878c041b8e7a9d424  tests/tdpd/dzen1002-fact-boundary.test.cjs
153172634cf0f89c73d5199aa87c607c8d89c38fe3e60974060cda7fd872fd6f  tests/tdpd/dzen1002-runtime.test.cjs
```
