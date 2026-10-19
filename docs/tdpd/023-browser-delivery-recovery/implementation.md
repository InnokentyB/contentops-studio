# Recovery v2 — engineering result and activation limits

Status: engineering core tested, ready for review; live capability admission, production migration/deploy and owner UAT NOT performed. MEMORY-001 is a separate worktree/change set and is not part of this patch.

## Implemented behavior

The existing uncertain-result boundary returns code, stage, deliveryCertainty, causeCode, recoveryAction, safe explanation and correction. Real MCP serialization preserves this projection rather than replacing it with a generic reconciliation code. Scoped diagnosis reads persisted v2 status where storage exists; legacy attempts retain conservative UNKNOWN. Raw stored errors remain private.

Application-registered readers can run automatically inside the owning operation through createBrowserRecoveryOperation. The finite coordinator uses durable per-request reservations, cumulative three-round/twenty-request/180-second limits, 0/30/120-second backoff, cancellation, and a thirty-second per-round read ceiling. Restart/replay cannot reset budget. Account/package/body/assets and the immutable lookup time window are correlated; incomplete/no-match results never grant resend.

The pre-first-permit service resumes only the same attempt with new generation/private lease after current owner/approval/package and technical executor-proof checks. Old challenges are superseded atomically. No error history is cleared, no extra attempt or submit permission is created. Replay after expiry, a held state, a newer generation or a permit cannot advertise executor pickup.

Verified FOUND uses the existing canonical fact transaction. Attempt, fact, recovery and audit commit together; beforeCommit rechecks cancellation, deadline, current owner and recovery generation. All canonical fact callers, including other internal callbacks, obey the recovery hold. A late legacy response cannot bypass it. Disabling new admission does not disable guards on persisted v2 rows: storage discovery is independent of the admission flag.

## Verified evidence

- RED: actual lifecycle responses lacked recovery data; real MCP projection discarded it; new PostgreSQL storage absent. Separately reproduced stale pickup replay, flag-off hold/status/admission regressions, bypass through an unrelated internal fact callback and cancellation after beforeWrite.
- GREEN: 179 focused and affected shared-browser/native/MCP/auth/PostgreSQL scenarios, zero failures/skips; full output in test-output.txt. Includes SQL delta retention/tenant-FK/uniqueness/budget constraints, actual canonical writer, races, rollback, revocation, late responses and safe serialization.
- Additional historical fact/store regressions: 38 tests passed in Docker; only the exact readonly storage probe was added to one fake transaction fixture.
- Backend Prisma/TypeScript and frontend TypeScript/Vite build passed in the reviewed Docker image. Existing dependency eval warning remains pre-existing.
- Quality gate prior to final handoff passed score77/min77 and runtime policy7096/7096, without baseline edits/exemptions. Final gate artifact accompanies handoff.

SQL delta was applied to a synthetic pre-v2 schema. A separate transaction tests the same SQL with only schema-name substitution against a seeded prior attempt, preserving it and rolling back the temporary schema. This is not evidence of the entire historical migrate-deploy chain or any production migration.

## Deliberate activation gaps

No real provider reader or technical executor is registered by this patch. The default existing lifecycle path returns READBACK_CAPABILITY_UNAVAILABLE, or PRE_DISPATCH_PROOF_UNAVAILABLE for legacy preparation failures. The framework's synthetic tests do not establish provider access. Resume ends at private registered-executor pickup, without submission permission; no public resume tool is advertised while that pickup/permit integration is unverified.

X has an existing signed extension readback, but its budget, journal/generation and route integration still need admission-specific engineering and a separately authorized smoke. LinkedIn/DEV.to/Setka have no generic registered lookup; VK/Dzen historical incident readers are not shared authority. See capability-matrix.md. Do not activate a reader merely because its HTTP call or a screenshot succeeds.

A truthfully observed historical object remains protected evidence if current approval/package gates prevent canonical finalization. No historical fact-authority bypass is added. Frozen attempts are not swept or resumed at startup. There is no new scheduler, publisher, transport fallback or task-specific code.

## Reproduction and rollout

All commands below run Docker workloads on Tower. No production .env is used.

1. Build: `docker compose -f ops/quality/compose.yaml --profile build build build-check`.
2. Start the separate temporary DB: `docker compose -f ops/publication-tests/recovery-compose.yaml up -d synthetic-db`.
3. For a new empty synthetic DB only, schema readiness: `docker compose -f ops/publication-tests/recovery-compose.yaml run --rm tests node node_modules/prisma/build/index.js db push`. This is not a SQL migration test; the delta scenario checks SQL separately.
4. Tests: `docker compose -f ops/publication-tests/recovery-compose.yaml run --rm -e TELEGRAM_BOT_TOKEN=123:synthetic-test-only -e JWT_SECRET=synthetic-recovery-only tests sh /workspace/ops/publication-tests/recovery-checks.sh`.
5. Stop/remove only this temporary stack: `docker compose -f ops/publication-tests/recovery-compose.yaml down`. No volume deletion/pruning.

Production rollout remains separate: review migration/backup, deploy all writer guards before any admission, preserve holds during rollback, authorize/test each registered reader and executor, then perform explicit owner UAT. New sends after uncertainty remain excluded, including after PROVEN_NOT_SENT evidence. This patch must not be merged/deployed under an earlier diagnostics or MEMORY-001 permission.

The final review also fixed permanent-blocker replay: subsequent recovery returns the retained permission/approval/package action, rather than a misleading in-progress message. Lookup windows and the original deadline stay immutable; admission time is charged to the overall budget. A retained pre-fix snapshot reproduces the blocked-action replay defect separately from final GREEN.

Central commit checks live in a narrow typed transaction adapter. The original canonical transaction body and legacy isolation options remain unchanged, preserving existing controls and avoiding any baseline remap or exemption. Both matching replay and normal writes pass the new commit boundary before their transaction can commit.
