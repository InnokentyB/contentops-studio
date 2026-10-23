# Narrow approval-preserving preparation repair — proposed design

Status: LOCK/QAR/ARCH/RISK directly approved by the Owner on2026-10-23 before scenarios and implementation: «Да, утверждаю локальную реализацию исправления для №1159. Делай и проверяй.» Local implementation only; no public push/deploy, production repair or provider send authorized by this approval.

## LOCK

An existing accepted Telegram task in approved/approval_required state can finish normal preparation and become ready_for_execution using its exact current accepted text, active approved durable visual (or valid no-visual decision), and current channel/placement/schedule. Use existing ba_prepare_publication_task, not a new task-specific repair or fake Art/text approval. Publication mode stays approval_required; separate normal Owner release and sole Publisher send remain required. Already ready tasks and owner_released tasks retain existing preservation behavior. Drafted tasks are not silently accepted by preparation.

## QAR

Zero provider calls, sends, release permissions, new attempts or new reviews. No changed text/revision/asset/decision/review metadata. Tenant/authenticated actor binding, exact snapshot/CAS, audit atomicity and idempotent repeated preparation. A changed package, stale/rejected visual, unresolved storage/reassessment, fact, hold, existing delivery, release or executing/leased work cannot obtain a ready transition. All failures expose a specific safe cause and supported next step. Docker acceptance/build/quality and existing approval/owned-lifecycle regressions must pass; live UAT remains separate.

## ARCH

Repair only the approved + approval_required + supported direct Telegram preparation branch. Reuse the existing publication mutability/hold/review/visual checks. Re-read exact package and durable guards inside one bounded transaction, rebuild the current handoff, compare the initial snapshot/CAS, persist ready_for_execution and prepared handoff without setting connector_auto or owner_released. Write an immutable preparation audit with authenticated actor and before/after package hashes; failure rolls back readiness. Pass authenticated actor from the existing MCP boundary rather than trusting caller impersonation. Other interfaces without a verified actor must not enter the new mutation path. No schema migration, sender, business-ID route or global scheduler activation.

## RISK

The central risk is mistaking preparation for release or accepting a changed brief/text/visual. Preparation only operates on an already approved current canonical revision and checks actual visual approval/decision binding; it does not establish a new acceptance or overwrite review history. Existing exact Owner release remains the authority to send. Preserve the current ready/approval_required read-only regression and all owner_released behavior. Historical UNKNOWN or delivery state is not repaired by this path.

## Evidence and bounds

Publisher reports exact rematerialization restored task1159 to approved, but prepare leaves it approved. Source prepare's preserve_approval branch returns without writing; Owner Telegram release requires ready_for_execution. Existing three materialization tests passed in Docker. Source has an explicit zero-write test for an already-ready approval_required task; retain it. Initial reschedule also changed brief, so removal of the brief comparison is explicitly excluded.

Public push/PR, migration/deploy, production repair and provider send are excluded from this local implementation design approval. The existing sole Publisher remains sender after a separately authorized release.
