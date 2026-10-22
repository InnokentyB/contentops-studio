# Direct Owner publication command

Status: Owner explicitly requested removal of the UNKNOWN/duplicate veto and accepted duplicate publication risk on 2026-10-22. The Owner explicitly approved the concrete LOCK/QAR/ARCH/RISK architecture before scenarios and implementation: «Утверждаю, реализуй». Production remains a separate release boundary.

## LOCK

An authenticated project Owner can explicitly order a new browser submission despite a previous UNKNOWN attempt or an existing matching provider post. No proof of absence, independent recovery reader, legacy executor quiescence or manifest-compatibility proof is required for that new command. Do not ask the Owner to restate the same command or duplicate-risk acceptance at every lifecycle step. Agents without that exact Owner command retain the existing automatic retry/duplicate restrictions.

Keep this a normal reusable lifecycle, never a task1124-specific branch. Record the command once for the exact current project/channel/content revision/body/asset/account and current manifest, then let the sole Publisher execute it. Provider permission/site denials remain external execution constraints rather than a Planner duplicate veto. Connecting a different account or publishing different content is not authorized by this command.

## QAR

One distinct Owner command permits one additional submission. Re-delivery of that same command does not generate extra submissions; a new deliberate command can authorize another. Old attempt errors, UNKNOWN status and facts remain historical truth, never rewritten into not-sent or success. Successful new delivery records its own actual result. Invalid credentials, foreign tenant, agent-forged authority, changed package and audit failure cause no authorized operation. An old callback cannot settle the new operation.

## ARCH

Add a generic Owner-only explicit publication instruction and immutable audit record, bound to the current exact package and one operation key. Publisher consumes that instruction; it cannot mint another or enlarge its scope. Start a separate numbered attempt and work generation under that instruction; retain the old attempt and its original release snapshot. Invalidate old Planner lease authority when adopting the new instruction, without demanding retrospective proof that no external effect was possible. That external duplicate risk is accepted by the Owner.

Remove UNKNOWN/prior-attempt and duplicate-absence vetoes from this explicitly Owner-authorized branch at release, start, pre-submit and confirmation. Keep ordinary agent execution unchanged. Current canonical facts are unique per content item: this narrow first implementation covers blocked/UNKNOWN tasks without a Planner canonical fact, even if a provider duplicate exists. Re-publishing a task with an existing Planner canonical fact requires a separate publication instance preserving both facts; do not silently overwrite one. That additional case is not disguised as this repair.

Use current exact package authorization rather than modifying the historical manifest or labeling this as legacy recovery. No automatic resend loop, new sender, provider transport, frozen-attempt deletion, raw secret logging or new business-ID allowlist. No new table is proposed for the blocked/UNKNOWN slice; use existing work/attempt/audit storage with a versioned command contract. Runtime authorization must distinguish Owner instruction creation from Publisher consumption using authenticated capability profiles, not actorId supplied in a request or a caller Boolean claiming to be human.

## RISK

Duplicate provider posts and a possible late old delivery are expressly accepted by the Owner for the new instruction. Do not substitute proof-of-absence/fencing requirements back into this branch. Preserve tenant ownership, target identity, exact text/image, actual result evidence and audit. Do not mistake a known duplicate-risk policy for proof that the previous send did not occur.

## Exact removal sites found in deployed source edef3a1

- browser_publication_contract.ts:noBrowserDelivery rejects any prior attempt.
- browser_publication_release.ts:ready/release reject existing task publication state/work and bind the old release.
- browser_publication_execution.ts:startBrowserSubmission rejects prior attempts; preSubmitBrowserSubmission rejects attempt.error_message.
- browser_publication_guard.ts:checkedBrowserAttempt insists on exactly one task attempt; assertBrowserObserved requires duplicateAbsent=true.
- browser_recovery_guard.ts:assertBrowserRecoveryWriter blocks task-wide persisted holds.
- browser_publication_confirmation.ts validates the current release/attempt/permit, so changing only the first check leaves the request blocked later or records the wrong result.

These are coordinated release/start/permit/result checks, not a single plugin setting. No business-specific code or live SQL reset is an acceptable substitute for removing the veto in the complete Owner-command path.

## Approval and release

Project AGENTS.md requires: “Approve LOCK (goal/specification), QAR (measurable non-functional requirements), ARCH (architecture) and RISK (security/adversarial review) with the human before scenarios.” The Owner has already approved the goal and duplicate risk; approval of this concrete reusable architecture and scope was received before scenarios/implementation. No second publication GO is requested. Once approved: failing boundary tests first, implementation, Docker build/focused/PostgreSQL/quality checks, reviewable exact diff/commit and release through the existing production gates. Engineering verification does not itself send a post.
