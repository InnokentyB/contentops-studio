# Independent architecture and risk review — reusable Dzen lifecycle

Date: 2026-10-17. Reviewer: `/root/dzen_runtime_review_retry`.

Verdict: **CONSTRAINED — READY FOR OWNER ENGINEERING-PLAN VERDICT**.
No open P1/P2 findings in the reviewed plan. This is an independent review of a
proposed engineering contract, not human LOCK approval, implementation acceptance,
production readiness, deployment permission or provider-policy clearance.

## Exact reviewed material

- Package: `DZEN-ADAPTER-LIFECYCLE-001`.
- Plan: `docs/tdpd/dzen-independent-adapter-lifecycle-plan-2026-10-17.md`.
- Reviewed commit: `be4f63e604a3bc913a3fdc18a33f6c52ee63dbd8`.
- Plan SHA256: `d00e091cacdf9ffed1801fc0c2c961e9086c63c86dc3e0074db1330cb9bec37e`.
- Inspected source baseline: `8748b950d0f4b7c36a7520c69197d8ebae93abf3`.

Review method: read the plan and amendments; inspect source through Git at the
specified baseline. No project tests, database, application, browser, provider or
container workload was executed for this architecture review. No production code,
plan, baseline, gate, CI or operational record was changed by the reviewer. This
companion receipt is the only reviewer-authored change.

## Findings and closure

**P1 — Shared ConnectorDispatchJob queue isolation: CLOSED IN PLAN.**
The existing VK repository selects active jobs by project and then applies its
strict pilot decoder (`src/services/vk_connector_repository.ts`, candidates and
toJob). Merely inserting generic Dzen jobs would poison that reader. The revised
plan makes provider/protocol predicates a prerequisite before new job admission,
covering candidate selection, job/key/package lookups, claim/CAS/update and status
projections before provider decoding. It preserves unversioned VK history and its
strict decoder, rejects cross-provider key collisions, and requires mixed-queue
non-poisoning/non-starvation tests. No schema widening or backfill is authorized
by this closure. Implementation must prove these obligations before admission.

**P2 — Ambiguous effect selector: CLOSED IN PLAN.**
The plan now defines omitted/true dryRun as preview and `dryRun:false` as explicit
effect intent. There is no apply field. Its release/publish/reconcile matrix
specifies required bindings and incompatible fields while preserving other
providers' contracts. Actor authority comes from trusted server context; release
also requires the appropriate credential capability and owner membership.

**Legacy compatibility clarification: RESOLVED IN PLAN.**
A legacy attempt without a transport job completes only its original attempt,
fact and audit. Reconciliation cannot manufacture a job. Only an originally
linked, validated job may be completed. No replacement attempt, release, key,
lease/generation history or synthetic receipt is created to bypass uncertainty.

**Bounded final addendum: REVIEWED, NO OPEN P1/P2.**
The fifteen-line amendment after `cecf701` explicitly separates the immutable
release/job creation key from the original publish claim/attempt key and requires
reconciliation to present the original publish key. Neither operation may rewrite
the other's identity or create a fresh job/attempt. Background dispatch requires
a trusted scoped executor context. Import/materialization, week repair, task
prepare/content updates and status/fact projections join the ownership/history
preservation boundary and its RED/release tests. These clarifications close the
key ambiguity and make existing fence obligations explicit; no further
architecture scope or production authority is inferred.

## Architecture assessment

The plan addresses the actual source gaps rather than assuming the generic MCP
command already invokes PublicationDispatcher. It requires dynamic tenant-owned
routing and trusted principal propagation, delegation before legacy mutations,
terminal blocked/reconciliation results, and operation-level authorization.
Shared browser primitives are reused selectively: Dzen needs provider-owned
admission and receipt verification, not an enum addition or caller observations
accepted as native evidence.

The proposed shared ownership fence must cover every old and new producer and
manual/import/fact path. Row-lock/CAS and all-history inspection supplement job
uniqueness; a new key, revision, account, expired lease or complete inventory does
not reopen a started/uncertain item. Immutable receipt custody remains independent
of current mutable eligibility, while canonical completion checks current access
and commits fact, original attempt, applicable original job and audit atomically.

The existing publication command remains the operator boundary. The proposed
independent registered adapter owns its session and uses bounded private IPC;
test composition roots cannot become production permission/transport seams.
Account/task/package identifiers remain validated data. The plan introduces no
new publication-specific production authority or preflight MCP command.

## Conditions and remaining evidence

Combined human LOCK/QAR/ARCH/RISK approval remains required before final scenarios,
RED and implementation. After that approval, the one coherent package permits
incremental offline implementation without separate routine milestone approvals.
Material migration, security or architecture changes require renewed review.

Engineering delivery must still supply executable evidence: real authenticated
boundary tests; two unrelated packages/accounts and foreign-tenant negatives;
mixed-provider queue isolation; separate-process PostgreSQL old/new writer races;
single-start/Submit and UNKNOWN no-resend behavior; receipt/fact crash and mutable
drift tests; manual/import/batch bypass and rollback tests; actual sandboxed local
browser fixtures; bounded cleanup/network/secret handling; quality/build gates;
independent implementation review and per-build TRUN records. No such outcomes
are established by this document or inherited from the previous exact-task tests.

Rollback must preserve custody, historical namespaces and reconciliation fences;
it cannot reactivate legacy sends or disable the browser sandbox. Any required
schema/index change needs an explicit compatibility/backup/rollback amendment.

Production integration and native feasibility remain unverified. Deployment or
activation requires a concrete reviewed build/configuration and explicit owner
authorization. The actual task1045 tool refusal remains binding; applicability
to intended Dzen actions is unresolved. Neither this review nor engineering
approval, a new adapter, a stored flag or a probe resolves that policy question.
Permitted real-path smoke, exact current release/package/manifest/history checks
and explicit human UAT remain separate release requirements. No live action or
publication permission is granted here.
