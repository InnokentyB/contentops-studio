# LOCK-023 acceptance scenarios

Status: approved design translated into final acceptance scenarios; **execution pending**. No row below claims RED, GREEN, runtime readiness or owner UAT. Approval: «Утверждаю этот дизайн и границы реализации», current coordinating chat, `request_user_input_async` call `call_1dffb0ee77fd421f8746481c6c5bd387`, 2026-10-18. Scope and exclusions remain those of design.md and lock.yaml.

Operator boundary: existing shared browser lifecycle MCP and owning adapter execution response, plus additive safe recovery assessment in existing diagnose. Tests use synthetic tenant/package/attempt records and registered deterministic read-only dependencies inside Tower Docker. Public providers, sessions, production data and live frozen attempts are excluded. `retry_allowed:false` and `submission_permitted:false` are invariant on recovery responses, including preparation resume and positive absence proof.

## Scenario matrix

| ID | Trigger / arrangement | Required observable outcome | Rules / QAR | Verification surface |
|---|---|---|---|---|
| S01 | Legacy attempt has only free-text preparation error; no trustworthy no-dispatch proof | Legacy UNKNOWN; no synthesized NOT_DISPATCHED, resume or provider call | R01,R02,R09 / Q01,Q04,Q07 | Classifier, MCP, DB no-write assertions |
| S02 | Trusted pre-permit preparation failure; unchanged release/package; technically fenced executor | Resume the same attempt, rotate lease and execution generation, audit atomically; no new attempt/key or send permission | R02,R08 / Q01,Q05 | Resume contract and PostgreSQL transaction |
| S03 | Pre-permit lease expired but no enforceable executor-quiescence evidence | UNKNOWN / CONTACT_ENGINEERING; expiry alone cannot admit resume | R02,R03 / Q01,Q04 | Negative resume and actual MCP |
| S04 | Old native challenge outstanding during authorized preparation resume | Account for and supersede challenge atomically; old generation/lease/signature/receipt cannot mutate resumed attempt | R02,R08 / Q01,Q05 | Native ingress regression and PostgreSQL race |
| S05 | Permit issued, response lost, permit expired or dispatch potentially started | POSSIBLY_SENT/UNKNOWN; reconciliation only, never resume or renew a permit to resend | R03,R06 / Q01,Q04 | Lifecycle, native journal and permit regressions |
| S06 | Uncertain attempt has registered supported permitted read-only reader | Owning authorized operation automatically starts bounded read-only reconciliation, no separate owner GO for transient retry | R04,R07 / Q03,Q08 | Coordinator + actual MCP response |
| S07 | No admitted reader, wrong provider/tenant/account or denied route | READBACK_CAPABILITY_UNAVAILABLE or established permission cause; zero reader/submit calls and no substitute transport | R04,R08 / Q04,Q05,Q07 | Capability admission / negative integration |
| S08 | Trusted unique provider match, matching tenant/account/package/object/time; current fact gates pass | Finalize original attempt and one canonical fact using existing fact service; matching replay returns same result | R05,R08 / Q01,Q02,Q05 | PostgreSQL canonical service integration |
| S09 | Readback FOUND races late signed response, confirmation or uncertainty | One matching canonical outcome, otherwise held conflict; zero overwrites/partial commits | R05 / Q01,Q02 | Real PostgreSQL concurrent transactions |
| S10 | Approval revoked, installation revoked, manifest/config or immutable package changed before resume/finalization | Exact safe established blocker; no dispatch/fact bypass; retain historical observation as protected evidence | R05,R08 / Q01,Q02,Q05 | Transaction hooks and revocation races |
| S11 | Fact/recovery/attempt/audit write fails mid-finalization | All-or-nothing rollback; subsequent matching authorized invocation can safely reconcile retained evidence | R05 / Q02,Q05 | Injected PostgreSQL transaction failure |
| S12 | Reader finds no matching visible object | NOT_FOUND remains UNKNOWN, bounded future read only; never NOT_DISPATCHED or resend | R03,R06 / Q03,Q04 | Coordinator deterministic clock + MCP |
| S13 | Missing page/collection/time window/read consistency, duplicate candidate or identity uncertainty | Named coverage/ambiguity blocker; UNKNOWN, no inferred zero/absence, correct human role if unresolved | R06,R07 / Q04,Q08 | Evidence classifier and response serialization |
| S14 | Reader supplies strong positive non-delivery proof | PROVEN_NOT_SENT evidence stored, but no new-send permission or new attempt in this slice | R06 / Q01,Q04 | Classifier/coordinator/guard integration |
| S15 | Temporary timeout/rate-limit/dependency failure | WAIT_SYSTEM_RETRY within durable backoff; no fresh owner approval request, no submit call | R07 / Q03,Q08 | Deterministic timeout/cancellation |
| S16 | Repeated requests, concurrent workers, process interruption or crash during reserved read | Same cumulative counters/deadline; reservation retained conservatively; lost read lease cannot commit fact/state | R04,R07 / Q02,Q03 | PostgreSQL CAS and interruption scenario |
| S17 | Round/request/deadline budget exhausted or request reaches deadline | At most 3 rounds at 0/30/120 seconds, 20 provider requests, 180 seconds total; cancellation; UNKNOWN plus concrete support action | R06,R07 / Q03,Q08 | Clock/request accounting + container interruption |
| S18 | Permanent engineering capability defect versus permission/approval/package/ambiguity failure | Correct cause, concrete correction and responsible role; transient failures do not become owner blockers | R07 / Q08 | Operator response contract |
| S19 | Malformed, forged trusted flag, cross-tenant or stale-generation recovery request | Fail closed; zero unauthorized writes/reader/submit calls; append authorized audit only | R01,R08 / Q01,Q05 | Actual MCP and PostgreSQL boundary |
| S20 | Dependency errors/evidence contain synthetic secret markers, copy, approvals or provider payloads | No markers/raw values in API/MCP or console/file logs; safe reasons and protected evidence references only | R10 / Q06 | Boundary interception and log assertions |
| S21 | V2 attempt reaches any existing mutation ingress | Every writer enforces common v2 fence or rejects; no bypass via legacy/manual/native/specialized path | R02,R08 / Q01,Q05,Q07 | Ingress inventory and regression suite |
| S22 | Existing v1 attempt and unsupported provider read/resume operations | Existing conservative behavior retained; v2 remains visibly disabled unless all capability/writer checks pass | R08,R09 / Q04,Q07 | Discovery/response compatibility |
| S23 | Service deploy/startup or process restart with historical frozen attempts | No unattended scan, reader call, resume or dispatch; only a subsequent authorized owning invocation may use remaining read-only budget | R04,R09 / Q01,Q03,Q07 | Initialization/constructor/entrypoint assertions |
| S24 | Rollback requested while permit/read lease outstanding | Disable admission and mutating v2 execution, cancel reads, retain holds/evidence/schema; no downgrade to an unaware writer or retryable reset | R03,R08,R09 / Q01,Q07 | Synthetic rollback safety scenario |
| S25 | Additive recovery migration against synthetic prior schema with existing attempts/facts/audit | Existing data retained; tenant/unique/FK/CAS constraints enforced; no legacy certainty backfill | R08,R09 / Q02,Q05,Q07 | Real PostgreSQL delta migration test |
| S26 | Completed implementation | Focused tests, relevant regression, backend/frontend build and no-regression quality gate have actual per-build TRUN records | R08 / Q09 | Tower Docker checks; owner UAT separate |

## QAR coverage index

- Q01: S01–S05, S08–S10, S14, S19, S21, S23–S24.
- Q02: S08–S11, S16, S25.
- Q03: S06, S12, S15–S17, S23.
- Q04: S01, S03, S05, S07, S12–S14, S22.
- Q05: S02, S04, S07–S11, S19, S21, S25.
- Q06: S20.
- Q07: S01, S07, S21–S25.
- Q08: S06, S13, S15, S17–S18.
- Q09: S26 and the per-build evidence for every implemented scenario.

## Delivery stages and evidence discipline

1. Contracts/classification/admission and disabled operator assessment. Establish RED at actual boundary; no admitted live readers.
2. Additive operational persistence and common writer guard. Prove tenant/unique/FK/CAS, migration retention, old/new ingress exclusion and rollback before capability admission.
3. Finite coordinator and preparation resume against registered synthetic ports. Prove cumulative budget, fencing/challenge supersession and no submit import/call.
4. Existing canonical finalizer integration and actual PostgreSQL concurrency/rollback tests. No substitute fact writer.
5. Relevant build/quality/regression TRUN and reviewable handoff. Engineering completion and owner UAT recorded separately. Provider enrollment/smoke, production migration/deploy and any publication require separate authorization.

Each actual TRUN records build/revision, command, scenario IDs, results/errors and timestamp. An environment failure, missing test or static review is not a passing scenario. These files intentionally contain no claimed execution outcomes.
