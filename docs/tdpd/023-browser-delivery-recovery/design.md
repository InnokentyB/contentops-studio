# Browser Delivery Recovery v2 — LOCK / QAR / ARCH / RISK

Status: APPROVED FOR SYNTHETIC IMPLEMENTATION; engineering validation and owner UAT pending.
Date: 2026-10-18. Source baseline: engineering checkout 1d61c72 (same source tree as approved diagnostics rollout); production rollout merge 9defd94 is contextual, not fresh provider evidence.
Method: TDPD / Test-Driven Product Development, an original method by Innokenty Bodrov.

## LOCK-023 — problem, surface and authorization

Owner objective: automatically recover safe transient failures; request human action only when a person can resolve a real blocker. Stop collapsing preparation failures and potentially delivered submissions into the same manual dead end.
Primary surface: existing shared browser lifecycle MCP responses and owning adapter execution response; additive structured recovery projection in existing diagnose response. No new UI, publisher, scheduler, browser/session, credential or account authority. No incident-specific production identifiers or dispatch branches.
Authorized work: concrete design, synthetic TDD implementation and local engineering evidence. The owner directly approved the bounded recovery architecture, measurable QAR and RISK/admission boundary in the current coordinating chat on 2026-10-18; this approval authorizes final scenarios, RED and synthetic implementation under AGENTS.md. This packet does not authorize production migration/deploy, remote disclosure, provider smoke, live lookup or resuming frozen attempts. Earlier diagnostics deploy approval is not reused for recovery.
Reliance/harm: high integrity risk; duplicate public publication is hard to undo, may have delayed consequences. Fail closed on uncertain delivery, incomplete evidence, revoked approval and untrusted executor claims.
Canonical truth: existing DeliveryAttempt, immutable accepted package/release, WorkItem, WorkflowEvent and PublicationFact. Recovery metadata is subordinate operational state, never an alternate publication fact.

### Rules

- R01: Separate stage, deliveryCertainty, causeCode and recoveryAction. Never derive certainty from a free-text error or caller assertion.
- R02: Before any issued permit, resume the same attempt only with trusted proof of no dispatch and an enforceable executor fence; increment execution generation, rotate lease, revalidate unchanged approval/package and append audit atomically. No new attempt or idempotency-key bypass.
- R03: An issued/lost permit or possible dispatch requires read-only reconciliation. Expiry, absence of a receipt and empty inventory cannot establish NOT_SENT.
- R04: Reconciliation starts automatically inside an already authorized owning operation when a registered supported reader exists. It is bounded and cannot call a submit transport. No automatic replay of old frozen attempts on deploy/startup.
- R05: Verified unique provider match finalizes the original attempt and canonical fact idempotently through existing authorization/fact gates; conflicts retain evidence and freeze.
- R06: NOT_FOUND, partial coverage, ambiguous match, unsupported reader and exhausted budget remain UNKNOWN. New sends after uncertainty are outside this slice, including PROVEN_NOT_SENT; that classification supplies evidence only.
- R07: Temporary dependency failures are retried by the system within budget; they do not request owner approval. Permanent engineering capability failures route to engineering. Permission, approval, package and ambiguity failures identify the actual human role and specific action.
- R08: Preserve tenant scope, accepted revision/assets, registry bindings, audit, native signatures/nonces/journal, all denials and Dzen/VK independent-adapter route.
- R09: Legacy attempts lacking trustworthy v2 evidence remain legacy UNKNOWN. No backfill may assert that no send occurred.
- R10: No raw errors, copy, approvals, tokens, cookies or session payloads in operator diagnostics/logs. Protected evidence is referenced, not dumped.

## ARCH-023 — approved implementation boundary

### Chosen architecture

Use an additive one-to-one BrowserDeliveryRecovery operational record for a DeliveryAttempt, with tenant-composite foreign key, contractVersion, rowVersion, executionGeneration, package digest, immutable original release binding, stage, deliveryCertainty, sanitized cause/action, recovery lease hash/deadline, cumulative budget counters, nextReadAt and evidence references. Database constraints prevent multiple recovery records per attempt. Keep raw lease/permit tokens out of audit/logs. Exact evidence schema and persistence validation are typed and versioned; no arbitrary provider JSON in diagnostics.

Use dedicated operational state rather than encoding canonical recovery into WorkItem.result_payload, quality_report or error_message. Existing release proof must remain immutable. WorkflowEvent remains append-only audit, not an unbounded event scan for every retry. Local migration tests use synthetic PostgreSQL only; production migration approval is separate.

Modules: recovery contract/classifier; transactional repository/fencing; finite coordinator; registered read-only provider ports; canonical finalizer integration; safe diagnostic projection. Depend on existing package/authorization checks and fact service. No recovery module imports a provider submit transport. At the readback boundary, use application-registered ports with validated capability evidence, not caller-selected functions or a caller-provided `trusted:true` flag.

Do not publish a generally active recovery tool while readers/fencing are unsupported. Existing lifecycle integrations activate v2 only for explicitly admitted capabilities; unsupported states return precise gap/status without changing their permission to send. No implicit migration of v1 workflows to v2.

### State and recovery outcomes

Stages: PREPARE, PERMIT_ISSUED, DISPATCH_STARTED, AWAITING_RESULT, RECONCILING, FINALIZED.
Certainty: NOT_DISPATCHED, POSSIBLY_SENT, CONFIRMED_SENT, PROVEN_NOT_SENT, UNKNOWN.
Compatibility: `retry_allowed:false`, `submission_permitted:false` on every recovery response. RecoveryAction distinguishes CONTINUE_SAME_ATTEMPT_AFTER_REPAIR, WAIT_SYSTEM_RETRY, READ_ONLY_RECONCILIATION, INSPECT_CONFIRMED_FACT, CONTACT_ENGINEERING, RESTORE_PERMISSION, REVIEW_APPROVAL, REVIEW_PACKAGE, RESOLVE_AMBIGUITY and NONE. Preparation resume is not submission permission; existing pre-submit guards remain mandatory.

| Code | Evidence / certainty | Allowed response |
|---|---|---|
| PREPARE_FAILED | Trusted pre-permit failure, no dispatch possible | Repair then fenced same-attempt resume; bounded system retry for transient failures |
| PRE_DISPATCH_PROOF_UNAVAILABLE | No enforceable no-dispatch proof | Keep UNKNOWN; engineering action, never clear old error and retry |
| LEASE_EXPIRED_PRE_DISPATCH | Trusted no-permit proof plus executor fence | Rotate lease/generation on same attempt |
| PERMISSION_DENIED | Exact policy denial; certainty retained independently | No bypass/retry; specific permission action |
| APPROVAL_REVOKED | Current approval no longer valid | No resume/dispatch; owner reviews approval; historical evidence retained |
| PACKAGE_CHANGED | Current package differs from immutable attempt package | No resume or rebinding; owner resolves package; historical evidence retained |
| POST_SUBMIT_UNKNOWN | Permit issued or possible dispatch | Automatic bounded read-only reconciliation if admitted |
| RECONCILIATION_FOUND | Unique verified account/time/package/object match | Canonical fact through existing atomic gates |
| RECONCILIATION_NOT_FOUND | No observed match | Bounded further reading, then UNKNOWN; no resend |
| RECONCILIATION_COVERAGE_INCOMPLETE | Missing page, collection, interval or read consistency | UNKNOWN; named coverage gap |
| RECONCILIATION_AMBIGUOUS | Multiple candidates or insufficient identity | UNKNOWN; concrete review action |
| READBACK_CAPABILITY_UNAVAILABLE | No registered permitted reader | UNKNOWN; engineering capability action, not invented provider search |
| RECONCILIATION_TEMPORARILY_UNAVAILABLE | Timeout/availability/rate limit | System backoff within durable budget; no new owner GO |
| RECONCILIATION_BUDGET_EXHAUSTED | Operation/dependency budget exhausted | Persist UNKNOWN, current coverage and support action; no endless worker |
| RECONCILIATION_PROVEN_NOT_SENT | Strong positive non-delivery proof | Persist evidence; no new-send permission in this slice |
| RECOVERY_CONFLICT | Concurrent state/fact conflict | Re-read canonical state; return matching committed outcome or held conflict |

### Finite automatic operation

Approved default: at most 3 read rounds at offsets 0/30/120 seconds, overall deadline 180 seconds, at most 20 provider requests, each with timeout bounded by remaining deadline and provider limit. Retries share durable cumulative counters; reissuing the operation cannot reset them. Provider ports must honor cancellation and report every request/page; process death retains an in-progress reservation conservatively. On process interruption, a permitted subsequent invocation resumes the remaining read-only budget; no unattended startup sweep or scheduler is introduced.

A reader that cannot fit the budget reports its actual limited result; the coordinator never labels it exhaustive. No stacked 120-second inner polling plus outer retries without shared deadline. X currently has such an internal read loop and requires adaptation before joining this budget. HTTP cancellation and MCP/request runtime limits must be tested; expose persisted status if synchronous completion is unavailable.

Lookup sequence: direct known-object read when available; otherwise authorized account inventory. Store collection/cursor/window coverage and evidence freshness. Match tenant-owned account, provider type, dispatch time window, immutable revision/body, assets and canonical object identity. Version provider-specific normalization rules; hashes do not make unsupported transformations trustworthy. Provider publication time is not assumed identical to submit time or permit deadline.

For NOT_FOUND, even complete inventory does not prove NOT_SENT without a provider-specific strong guarantee excluding delayed creation/visibility and late executor activity. No generic wall evaluator `proven_absence` is imported as resend authority.

### Concurrency and finalization

All lifecycle mutations compare tenant, attempt, package, generation and rowVersion under transaction/CAS. Preparation resume and permit issuance serialize on the same recovery row. Gate immediately before dispatch; an already delivered permit cannot be recalled merely by rotating a database token. Old executor quiescence must be demonstrated, otherwise UNKNOWN.

Reconciliation has a separate read-only lease. A lost recovery lease prevents state/fact mutation by that worker. Finalization and late signed provider responses converge through one canonical transactional path. Matching replay returns the existing fact; a different object/package is a held conflict, not overwrite. Existing unique fact-per-task is preserved; prevent cross-attempt/provider-object conflicts in finalizer validation. Commit fact, attempt state, recovery state and audit together or roll all back.

Revoked approval or package change blocks execution and existing guarded finalization if required by current contract. Persist the historical observation in protected evidence; do not bypass current guards to manufacture a canonical fact or attach it to a new revision. A future historical-fact authority change is excluded pending separate design/approval.

### Rollout and rollback

Additive schema and contract version; no destructive migration or legacy error rewrite. Resume/read-only coordination independently disabled by default. Before enabling, require actual reader route evidence, fencing support, contract tests and separately authorized provider smoke/UAT. No boot-time processing of old attempts. Rollback disables new recovery work, cancels read operations, preserves all evidence/facts/freeze states and leaves schema in place; no reset to retryable or reissue of permits. Before live cutover verify backup and reviewed migration/rollback.

## QAR-023 — measurable acceptance

| ID | Target | Environment/evidence |
|---|---|---|
| Q01 | Zero extra dispatches under replay, crash, expired lease and concurrent recovery | Synthetic boundary tests and real PostgreSQL races in Tower Docker |
| Q02 | Exactly one canonical fact for matching concurrent readback/late response; zero partial commit on injected transaction failure | Synthetic PostgreSQL; canonical fact service exercised |
| Q03 | At most 3 rounds, 20 requests and 180 seconds per recovery operation; request replay cannot renew budget | Deterministic clock/cancellation tests plus container interruption scenario |
| Q04 | NOT_FOUND/incomplete/ambiguous/legacy evidence never authorizes resend | Operator-boundary negative tests; no submit-transport calls |
| Q05 | Every transition is tenant scoped and audited; malformed/cross-tenant requests cause zero unauthorized writes/provider calls | Real MCP serialization + synthetic DB assertions |
| Q06 | No secret markers/raw provider errors in responses or console/file logs | Deliberate synthetic secret injection at dependency boundaries |
| Q07 | Existing v1 contracts remain conservative; unsupported live capabilities visibly disabled | Compatibility regression + discovery/response checks |
| Q08 | Transient errors produce bounded system retry/status; only actionable permanent blockers escalate to the correct role | Operator scenarios with deterministic read-only adapter |
| Q09 | Quality gate no regression; backend/frontend relevant builds pass; focused + broader affected contracts green | Docker TRUN per build, actual results not proposed passes |

These are approved thresholds, not measured results. This design packet records no test passes; actual execution belongs in per-build TRUN evidence.

## RISK-023 — adversarial/failure review

| Risk | Required prevention/detection | Residual limit |
|---|---|---|
| Duplicate public send | No resend after uncertainty; server + executor generation gate; pre-permit proof | Generic v1 owning browsers cannot prove fencing; resume stays disabled |
| Forged not-dispatched/readback claims | Registered trusted port, signature/nonce where supported, scope validation | Executor-supplied observations are not independent provider proof |
| Late response vs recovery | Common atomic finalizer, rowVersion, matching replay, held conflict | Provider side effect remains external; no exactly-once claim |
| Approval/package race | Recheck in same transaction as resume/permit/fact mutation | Changed historical packages need separate fact-authority design |
| False absence | Coverage, bounded consistency reads, UNKNOWN on missing evidence | Exhaustive visible inventory still need not prove non-delivery |
| Capability laundering | Explicit registration; no legacy task-specific API/worker fallback | Missing readers are implementation debt, not inferred authority |
| Retry storm / timeout | Durable shared budget, cancellation, recovery lease | Crash cannot automatically resume without a later permitted invocation |
| Tenant leakage/secrets | Composite scope checks, allowlisted diagnostics, protected evidence | Evidence retention/access must follow existing project policy |
| Rollback incompatibility | Additive versioning; default-off; disable and hold | No production rollback/deletion is executed by this development task |

Independent read-only source reviews performed by browser_diagnostics and vk_diagnostics; human approval subsequently received for the bounded synthetic implementation. Independent reviews are design evidence, not a substitute for runtime verification or owner UAT.

## Capability evidence baseline (source inspection, no live readiness claim)

| Provider | Implemented path | Missing for admitted generic v2 |
|---|---|---|
| Shared browser | confirmation.ts requires known publicUrl, object ID and time; no search | Registered reader, trustworthy fencing, bounded coverage |
| X | extensions/x-native/pilot-native.js result reads profile; pilot-background.mjs reconciles signed same-journal receipt | Shared deadline/budget, precise causes, verified time/account/package matching and fencing/resume integration; live enrollment/readiness unverified |
| LinkedIn | Existing shared controls accept owning-Publisher readback; legacy service lists latest 20 posts | No admitted generic search; legacy list and task-specific recovery are not shared authority |
| DEV.to / Setka | Supplied known-object readback via owning Publisher | No generic registered provider lookup found |
| VK | DB-only job reconciliation; pilot execution consumes trusted wall evidence; explicit operator collector | No generic registered automatic lookup; pilot binding/flags and route restrictions persist |
| Dzen | Receipt-only completion; incident-specific recovery; separate public/inbound readers | No shared authoritative owned-publication lookup; action denials remain binding |

Sources: src/services/browser_publication_execution.ts, browser_publication_confirmation.ts, browser_publication_native.ts, x_native_advance.ts, x_native_execution.ts; extensions/x-native/pilot-native.js and pilot-background.mjs; src/services/linkedin.service.ts; src/services/vk_connector_dispatch.service.ts:279, vk_connector_execution.service.ts:150, vk_connector_reconciliation.ts, vk1048_operator_reconcile.ts; src/services/dzen1002_runtime.ts:63 and dzen1002_action_restriction.ts:12; docs/operations/shared-browser-publication.md and vk-owned-publication-route.md.

## Approved implementation decisions

D1 APPROVED: bounded v2 architecture/QAR/RISK for implementation against synthetic dependencies, including additive subordinate recovery storage and no new-send authority.
D2 APPROVED: strict admission; no same-attempt resume without technical fencing, and no claimed automatic provider recovery without a supported permitted reader. Missing capabilities remain explicit engineering work, even if that means existing LinkedIn frozen attempts cannot yet auto-recover.

Excluded decisions deliberately left for later: production migration/deploy, live capability enrollment/smoke, execution of any frozen attempt, and any new authorization/send after PROVEN_NOT_SENT. No approval for these is requested now.

Implementation sequence: use scenarios.md at the existing operator boundary; record failing synthetic tests, minimal patch, real PostgreSQL race/rollback and additive migration checks, quality/build/regression TRUN. Prepare a reviewable change and obtain any separately required remote-publication authorization. Human UAT and authorized live rollout remain separate.

## Independent review disposition (2026-10-18)

Read-only review by direct_adapter_diagnostics confirmed: database lease rotation does not fence an already issued browser permit; native signatures attest registered executor provenance, not independent provider truth; historical finalization still depends on current mutable manifest/config guards. The review recommends a disabled read-only assessment as the first integration slice. Findings are incorporated as follows:

- Resume checks authoritative absence of every issued permit and dispatch boundary, atomically supersedes outstanding native challenges, and binds generation to installation and attempt. A pending challenge must be accounted for; missing logs are not proof.
- Reuse the existing serializable canonical fact writer and its beforeWrite checks. No alternative recovery fact writer. Add revoked-installation-during-finalization and uncertainty-vs-FOUND races.
- A discovered historical object can remain an evidence finding when current fact gates reject it. Expose the exact approval/package/config blocker and do not claim successful canonical finalization.
- Preserve the release marker and native journal/challenge schema meanings. Dedicated v2 operational state is not an implicit release-version upgrade.
- Every existing mutator of the aggregate (claim/start/pre-submit/uncertain/confirm/reconcile/native receipt/advance and alternate dispatch routes) must either enforce the v2 fence or reject an admitted v2 attempt. Enumerate and test these entry points before GREEN; a sidecar consulted only by the new coordinator is insufficient.
- Mixed old/new writers are not assumed safe. V2 admission stays disabled until all writers enforce the guard. Rollback first disables admission and all mutating v2 execution, retains holds, and verifies no outstanding permit; a downgrade to an unaware old binary is not an approved rollback procedure. Fail closed rather than asserting old runtimes understand the new schema.

Approved verification inventory (executable coverage/results tracked separately in scenarios.md and TRUN): pre-permit crash/resume with challenge supersession; lost permit response; signed replay; same-attempt resumed generation versus old receipt; temporary reader timeout and finite retry; crash without budget reset; FOUND against late response/uncertainty/revocation; incomplete pagination and eventual visibility; two candidates; historical package change; unsupported provider reader; cross-tenant denial; legacy frozen attempt; rollback with outstanding permit. Architecture approval authorizes final scenario drafting and tests; it does not establish passing evidence.

### Enumerated current ingress / writer review targets

Source search found shared lifecycle entry points in src/mcp/tools/browser_publication_tools.ts and signed native HTTP entry points in src/routes/x_native.routes.ts. Native mutations delegate through src/services/x_native_execution.ts; native read/phase advancement runs in x_native_advance.ts. The shared attempt writers are browser_publication_execution.ts and browser_publication_confirmation.ts. Canonical fact create/update remains in publication_fact.service.ts. Alternate-route protection also includes publication_manual_fact_guard.ts, browser_publication_fence.ts and exact_owned_route_guard.ts. These are the minimum affected ingress/writer review targets, not a claim of a complete repository-wide mutation inventory; RED planning must inspect canonical fact importers, synchronizers and specialized workflows before admission is enabled.

## Approval record

Approval source: the owner's direct reply **«Утверждаю этот дизайн и границы реализации»** to `request_user_input_async` call `call_1dffb0ee77fd421f8746481c6c5bd387` in the coordinating engineering chat on 2026-10-18. No exact timestamp is asserted. Approval covers LOCK-023, QAR-023, ARCH-023 and RISK-023 for bounded synthetic implementation, including D1/D2 and the independent-review safeguards above. It does not authorize production migrations/deploy, live provider discovery, session access, activating consumers, processing historical attempts, or publication.

Final acceptance scenarios are in [scenarios.md](scenarios.md); source-based provider readiness and admission limits are in [capability-matrix.md](capability-matrix.md). Engineering completion requires measured TRUN results and owner UAT remains pending.
