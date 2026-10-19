# Publication reliability — six parallel packages

Date: 2026-10-19. Owner explicitly requested all six workstreams in parallel. Source baseline is deployed main `3fd625a3b5ecce44fd6956ec0d1355e5ed3ff3e4` (recovery core PR183). All six packages are now integrated and engineering-verified locally. Production remains unchanged. See [combined TRUN](integration/trun.json) and [review](integration-review.md).

## Owner approval recorded

On 2026-10-19 the owner answered **«Утверждаю пять пакетов»** to the exact five-package LOCK/QAR/ARCH/RISK request. The linked designs are approved for synthetic acceptance tests and local implementation, including their described additive schema. Local implementation and combined verification are complete; owner UAT is pending. MEMORY-001 retains its prior separate approval.

The approval excludes publications, production activation or data changes, public push/PR and deploy. Material architecture changes require a separate decision. Engineering checks do not constitute owner UAT.

Workloads run only in bounded Tower Docker. Six independent source worktrees are prepared; no dependencies or production secrets copied into them. Builds are serialized to protect Tower capacity (17GiB free at start). Existing unrelated services/volumes/backups are preserved.

| Package | Concrete engineering scope | Current status |
|---|---|---|
| 1 LinkedIn | Bounded supported readback, trusted attempt-bound object/account/body/media, canonical finalization. History-only matches stay held. | [Approved design](linkedin/design.md); combined PostgreSQL/reader tests pass. Actual reader credentials/receipt issuer remain unregistered. |
| 2 Threads | Durable API phases/IDs, known-object GET reconciliation, atomic fact, persisted budget and final lease fence. Generic text-only feed scope. | [Approved design](threads/design.md); combined 11 PostgreSQL and 51 compiled regressions pass. Additive migration; default disabled. |
| 3 Read-only preview | Trusted session principal, read-only SQL allowlists, boolean-only hold/visual-authority projection, no secrets/provider access/send authority. | [Approved design](preview/design.md); real SDK and 6 PostgreSQL scenarios pass. |
| 4 Preparation resume | Protected additive ledger, durable outbox/pickup, technical quiescence, purpose-bound first permit, max3/180s, atomic shared completion. | [Approved design](prepare/design.md); combined same-attempt/rollback and API-reader integration pass. Real supervisor/authenticated pickup transport remain unregistered. |
| 5 Visual reassessment | Preserves accepted text/history; new art input and independent review; immutable authority checked at release/start/permit, Threads and preview. | [Approved design](visual/design.md); combined 17 acceptance and 46 affected regressions pass. |
| 6 MEMORY-001 | Idle-session expiry and disconnected executing-operation drain, preserved auth/session boundaries. | Integrated and verified again with current combined source. No RSS-savings claim. |

## Approved architecture boundary

The linked five LOCK/QAR/ARCH/RISK documents were approved for synthetic acceptance tests and local implementation. Limits, false-positive protections, additive schema and exact supported surfaces are part of approval. Provider protocol fields that remain unverified cannot be admitted merely because the design is approved.

Authorization does not include real sends, account/session logins, new scopes, bypasses of client/action denials, production data repair, frozen-attempt adoption, database migration/deploy, external code publication or automatic worker/scheduler activation. Those need their concrete reviewable release envelope. Existing approvals remain valid only for their exact scope (MEMORY implementation already approved; prior recovery deployment is not a blanket future release approval).

After approval: final scenarios → failing boundary acceptance → implementation → integration review/quality/builds → owner UAT. Preserve actual per-build TRUN errors. New code must remain generic and tenant-authorized, with no business-ID branches, baseline exemptions or raw secrets.

## Specific known limits that approval must not hide

- API reader existence is different from an admitted personal LinkedIn reader. Missing permissions/routes result in a precise capability gap, never a browser/API/session fallback.
- Durable post ID enables reliable Threads GET recovery; exact same text in history does not prove the original attempt. Current exhaustive history preflight can still block very large accounts; changing that duplicate policy is a separate decision, not an implicit relaxation.
- A rotated DB lease alone does not fence a browser that can still click Post. Such executors remain unsupported for automatic preparation resume.
- New preview may still be denied by host/client policy. Its read-only annotations must reflect actual zero-write/network behavior, not a guarantee about external settings.
- Owner visual requirements must survive pipeline-disabled shortcuts and late old callbacks. A material schema/fencing expansion is surfaced before implementation.
- MEMORY session-count cleanup is demonstrated; RSS savings are not. Eventual service restart needs a measured safe window; session count alone does not establish one.

## Source worktrees and current evidence

Branches `codex/reliability-{linkedin,threads,preview,prepare,visual,memory}` at `/tmp/contentops-reliability-{name}`. These are source-only worktrees, not runtimes. Durable design snapshots are the linked documents in this project. Do not merge all worktrees blindly; preserve individual source/evidence and integrate only validated packages.

MEMORY integration: c711b63, evidence383aacc/2542db3, worktree `/tmp/contentops-reliability-memory`. Actual report: `/tmp/contentops-reliability-memory/docs/tdpd/024-publication-reliability/memory/implementation.md`; TRUN alongside. Prior approval `/home/innokenty/migration-evidence/railway-memory-20261018/OWNER-APPROVAL.json`. No production actions performed for this six-package work.

## Review record

Independent preview/visual design review corrected query-time secret exclusion, persisted-only adapter evidence, and atomic reassessment completion/late-callback binding. LinkedIn review corrected unknown-ID causal correlation; prepare review distinguishes supersedable preparation challenges from issued submit authority. These corrections are in the linked snapshots. Tests/scenarios for the new designs have not been authored before the approval gate.

Independent MEMORY integration review found no confirmed actionable regression in changed code: executing requests remain protected after socket close/map deletion, shutdown closes admission before drain, and endpoint/profile/credential identity checks remain. A proposed generic closing-entry defensive invariant was evaluated but not promoted into an unproven production race; no unrelated behavior change was added. Durable verification snapshots are under [memory/](memory/implementation.md); original prior RED evidence remains in the source worktree's MEMORY-001 docs.
