# LINKEDIN1086-RECOVERY-001 / exact decision delta A

2026-10-16. EXACT HUMAN APPROVAL RECEIVED: Portfolio OS message
01a145fb-b06d-7f03-852e-7cbc7305852a answers questioncall_ad92d90550aa4f6eb7603909fdfdaf8f
“Утверждаю, риск дубля принимаю”. Main engineer read the actual human question
and answer through read_thread. LOCK/QAR/ARCH/RISK variantA implementation and
one unchanged-post send after verification are approved; engineering does not
perform the send. Original proposed sections below remain decision provenance;
see `docs/operations/linkedin1086-attempt41-recovery.md` for implemented boundary.
Supersedes the unattainable evidence prerequisite in the earlier
`linkedin1086-pre-submit-recovery-proposal.md`; does not weaken deployed guards.
Chosen option A: explicit owner acceptance of residual duplication risk, not a
claim of safe/no-risk retry or a provider no-send certificate.

## Evidence and the real remaining uncertainty

Historical snapshot at2026-10-16T13:52:27.087Z: p7/task1086/channel5, sole pending
attempt41, claimed WI1946, actor user2, expired lease15Oct20:48:48.260Z, factnull.
Events3262/3263/3264/3265 retain metadata repair/release/claim/start. No registered
pre-submit/confirm/uncertain event. Original publication-key SHA256
`9e4d4844b592c26cd54d7f0535114830bbf512c83db59eb457791fbd12b2a8a1`;
old lease SHA256
`daca078ba671310142569e4e6aa07811e8a86b3b8bb612959a55560ea0c2ac37`.
These are fingerprints, never replacements for private lease/key possession.

Fingerprint correction 2026-10-16: bounded production READ ONLY readback of
attempt41 confirmed the unchanged original key
`attempt-linkedin-p7-1086-r1-20261015-v1` and its SHA-256 above. The earlier
`29d531f3d40001aea514c054f83d59da87be3c480b787559642a83a323527153`
was a transcription error, not a second key or a changed attempt. Regression
R10 independently derives the fingerprint from that retained operation key.

Owner explicitly observed: personal post absent; latest personal post was3days
ago. Collection mode is `owner_observed_absence`, not exhaustive native search,
provider verification or no-send attestation. Do not ask owner to check again as
a substitute for this engineering decision. Observation time was not supplied;
record receipt time separately, never invent capture time.

Latest Ops report, received this turn (not independently repeated here): composer
absent; only personal recent-activity LinkedIn tab belongs to current engineering
chat, not old Publisher; OS audit found no separate LinkedIn/Playwright/Publisher
worker; original owned executor cannot be identified to kill. Planner prepare
normalized task status to `browser_required`, retaining attempt41/WI1946/factnull.
This is not an attempt reset and must not make start/renew eligible.

App thread read confirms `Seturon — Publisher / SMM`
01a13a4f-6dbf-7623-89a6-1651eefdaa8a is notLoaded; its16Oct10:22–10:25Z turn
completed and reported missing composer/no Post in that pass. Other identified
Seturon Publisher chats are notLoaded. Local automation search found no1086/1946
match. This is bounded local executor evidence, NOT exhaustive exclusion of all
publishers, queued browser calls, remote provider processing or a previously
unregistered click. Attempt/start records do not bind a thread/session/operation
ID. No supported tool in this review identifies/cancels that lost operation.

Therefore: application-level old credentials can be fenced; actual termination
of every old provider operation CANNOT be established from current evidence.
No kill, browser close, account logout, credential rotation or automation change
was performed. It would be false to report no-concurrent-execution proved.

## LOCK — exact scope and change set

Only p7/task1086/channel5, attempt41/WI1946, same actor user2, original release3263,
start3265 and original publication idempotency key. Preserve content/accepted r1,
bodySHA `52da1d66f2c06e3b953ac41f7e132a6a34ff6d83b4817edf9603fdcb8d9d865b`,
profile `https://www.linkedin.com/in/innokentyb/`, decision249v1
NO_VISUAL_NEEDED/feed/nullasset, both dates2026-10-15T09:00:00.000Z and current
manifest checksum pinned in `linkedin1086_contract.ts`. No new release/WI/attempt,
no available state, no historical deletion or status rewrite to failed/no-send.

Maximum one recovery generation1 and one NEW submit permit for this same attempt.
The permit count is application-enforced; physical browser behavior is still an
operator/client contract, not a server-verified exactly-once external side effect.
Any denial, existing permit, new/unknown attempt, fact, changed package, foreign
owner, or unsupported executor evidence keeps the operation blocked/reconcile-only.

Proposed small runtime diff after exact owner verdict:

1. New `linkedin1086_recovery.ts` (schema + preview/apply exact41 transition,
   no provider imports), using new pure `linkedin1086_recovery_decision.ts` with
   `assessLinkedIn1086Recovery` for local tests; the pure seam has only crypto
   dependency and issues no lease or permit.
2. Add preview/apply recovery tool registration in `linkedin1086_tools.ts` and
   publisher capability list; principal binds actor, no other role gains a tool.
3. Narrow recovery-generation handling in existing guard/lifecycle only: latest
   recovery fence + one-shot preSubmit, same-attempt actual-object reconciliation.
   Existing renew/start remain blocked after any attempt. No generic lifecycle
   rewrite, new infrastructure, secret, account config or DB migration.

## Exact owner decision — currently NOT given

The decision must explicitly accept: although the owner sees no post and current
local evidence shows no composer/worker, earlier send/noncompletion cannot be
proved. A delayed/previously unseen LinkedIn post can still cause duplication.
Owner accepts this residual risk for ONE generation1 permit on attempt41/WI1946
under the exact package above; this is not a claim of no-send, a future standing
retry permission, or permission to bypass a platform/tool denial.

Record the actual human message reference/text digest and authenticated owner
actor in immutable recovery audit, together with exact scope digest and literal
verdict `accept_residual_duplicate_risk_once`, packetId
`LINKEDIN1086-RECOVERY-001-A`. Chosen evidence mechanism: direct human answer to
this exact decision, read by the accountable operator in the owning conversation,
then submitted under existing authenticated owner control. Audit collection mode
is `operator_reported_human_reply`, `server_human_message_verification=false`.
The app checks principal/scope/verdict/audit, not a fictional ability to verify
Codex human messages. It must not label the reference as independently verified
human identity. The operator must actually receive the human reply; a tool/agent
claim, bare boolean, old publication GO or “Доводи” does not satisfy it.
No new approval service, certificate or owner UI is being invented.
Strict fields include nonempty bounded humanMessageRef and64hex
humanMessageSha256; missing/malformed digest, wrong packet/source or asserted
server verification blocks. Hash records what the operator actually read;
it is not a signature or independent validation of a human message.

## QAR — measurable controls and CAS

- Preview has zero mutations/provider operations and always submission_permitted=false.
- Apply runs in one SERIALIZABLE transaction; re-read current owner/manifest,
  exact package, release/start, sole pending41/current key, WI1946 claimed bysame
  actor, old lease SHA/expiry, task/WI/attempt updated_at and nofact/nopermit.
  Permit/confirm/uncertain checks span ALL keys, not only submitted control key.
- Exact owner risk approval and local evidence are auditable, attributed and
  bounded. Original executor status remains `not_identifiable`, provider inflight
  `not_excluded`; accept only this declared optionA, not falsified “terminated”.
- CAS touches task1086 and WI1946 with their observed versions and attempt41 with
  its observed version. Task may remain/return publishing from browser_required
  ONLY with verified sole existing attempt; no DeliveryAttempt.create ever runs.
- Rotate the SAME claimed WI lease to recovery generation1, expiry now+300s.
  Retain original fence SHA/expiry/start/audit fingerprints; raw lease returned
  privately once, never logged/audited. Work.result_payload remains release proof.
  Same recovery replay returns metadata only, never another lease/permit. No
  renewal or generation2, even under a different request/control key.
- Persist fixed-key recovery event for attempt41/generation1 and original
  publication-key SHA; event uniqueness plus task/WI/attempt CAS admits one winner.
  Serialization/conflict fails closed without auto-retrying provider work.
- A fresh personal author/editor/body/duplicate check AFTER recovery is required.
  Current exact human risk/action-time approval is bound; owner absence is not
  transformed into fresh exhaustive duplicate evidence. Actual matching post ->
  no permit, verified-object reconciliation only.
- Existing preSubmit command on SAME publication key gains recovery-specific
  checks: active generation1 fence, no previous permit across keys, exact native
  editor hash/author/history evidence, action-time confirmation and CAS same work.
  Atomically record ONE canonical preSubmit event, permit deadline now+30s.
  Response/replay after that event is reconciliation-only, never a fresh permit.
  Publisher must not click after deadline; missing/late result freezes attempt.
  The app cannot retract a boolean already delivered to an uncontrolled client;
  expiry is not proof of no physical click. This limitation is disclosed risk.
- UNKNOWN/error after permit -> same attempt41 verification_required, retain
  generation/fence/event; no re-arm/reset/retry. Never count a receipt as a fact.

## ARCH — real evidence method and reconciliation

No novel admission/certificate service is required. Re-use available artifacts:
owner direct absence observation; actual Ops tab/OS audit references; app
read_thread status/terminal tool-call observations; canonical task/attempt/event
readback immediately inside the recovery transaction. These inputs establish
bounded observations and app fencing, NOT impossible retrospective provider
cancellation. Preserve their provenance and limitations in audit.

No old executor can currently be named for a targeted stop. If it is subsequently
identified, stop/drain only that owned execution and retain actual completion or
cancellation acknowledgement, never a generic process absence assertion. If an
active old publish is discovered before recovery/permit, block even under optionA;
the bounded risk acceptance is not permission for known concurrent publishers.

Reconciliation must not fabricate an earlier preSubmit to satisfy current guard.
For an ACTUAL matching native post found before/after recovery, extend existing
same41 reconciliation narrowly: current owner/exact package, original start proof,
personal author, full text, strict canonical share/activity object/URL, actual
provider time not before original start minus existing tolerance, screenshot/native
evidence. Skip preSubmit requirement ONLY for that discovered-object path; no
submission_permitted flag is ever returned. Atomic fact + delivered41 + completed
WI/audit; retries read same fact, never send. Publication time remains actual.
Do not reuse company-only1135 identity helpers without removing incompatible
company scope through a reviewed personal-identity validator.

## RISK, compatibility and rollback

Residual duplication risk is HIGH and cannot be reduced to zero by a database
lease. Human sees/accepts that risk explicitly; unavailable historical evidence
is retained as unknown, not laundered into provider-certified absence.
Known active old work, tool denial or concrete contradictory provider result
blocks regardless of the owner risk verdict. No alternate browser/API transport.

Rollback disables recovery and new permits, preserves all rows/events and same
attempt; new lease expiry never restores old submit authority. Historical
original fence may be accepted for actual-object reconciliation only by matching
its retained hash/release/start; it can never pass submit. Existing other LinkedIn
tasks and Dzen/VK routes remain unchanged.

## Test plan / exact delivery boundary

Local RED file `tests/tdpd/linkedin1086-recovery.red.test.cjs` targets the absent
pure decision seam using synthetic snapshots. It tests no-risk-verdict rejection,
optionA disclosure, key/attempt/WI/package/date/owner drift, normalized task status,
old-permit/unknown/active-executor blocking, owner-observation attribution and
zero mutation/permit/token export. It does NOT prove transactional race safety.

After exact human engineering/risk approval, implementation acceptance additionally
requires real isolated PostgreSQL concurrent apply/preSubmit and rollback tests:
one recovery/onepermit, no DeliveryAttempt.create/WI.create/delete, immutable old
events/proof, simultaneous old preSubmit/recovery conflict, different-key replay,
expiry/restart/UNKNOWN freeze, actual-object reconciliation/no fake preSubmit,
manifest/role revocation and secret redaction. Existing1086/1128/1135 regressions,
backend/frontend build and quality gate; independent review; no-send owner UAT.
Only then may owning Publisher execute the single authorized exact package.

### Pure assessment contract exercised by RED

Input fields: `now`, `request` (strict scope projection + recoveryGeneration1),
`current` (trusted transaction snapshot), `localEvidence`, `ownerObservation`,
`riskAcceptance`. The real control adapter loads current state and verifies
owner principal, never trusts public JSON to supply current/owner evidence.
Fixture scope SHA is UTF-8 JSON of the fixed ordered `scope` object in
`tests/fixtures/linkedin1086-recovery.cjs` (same order for production projection).
Request does not contain raw key/lease; actual control separately holds the
private original key and rotates the private lease, neither goes to assessment.

Validation precedence: malformed outer/request/clock or unknown request fields
-> `LI1086_RECOVERY_INPUT_INVALID`; no exact risk verdict ->
`LI1086_EXPLICIT_DUPLICATE_RISK_ACCEPTANCE_REQUIRED`; wrong current owner/role
or accepted verdict actor/scope -> `LI1086_RECOVERY_OWNER_OR_VERDICT_MISMATCH`;
any current scope/visual/manifest/status drift ->
`LI1086_RECOVERY_SNAPSHOT_CHANGED`; fact/prior permit/recovery/nonpending or
multiple attempts/generation2 -> `LI1086_RECONCILIATION_ONLY`; known concurrent
publisher/composer or contradictory provider evidence ->
`LI1086_ACTIVE_OR_CONTRADICTORY_EXECUTION`; invalid/missing evidence or false
provider-verified/no-inflight claim -> `LI1086_RECOVERY_EVIDENCE_INVALID`.
Current scope values that are malformed count as snapshot drift, not a valid
request correction. Current states allowed are browser_required/publishing only.

Valid optionA yields `mode=recovery_review_ready`, submissionPermitted=false,
same attemptId41/workItemId1946/publicationKeySha256/recoveryGeneration1,
originalExecutor=not_identifiable/providerInflight=not_excluded,
duplicateRisk=residual_accepted/providerVerified=false,
newAttemptAllowed=false/newWorkItemAllowed=false. No raw input, token, provider
identity/URL or write/permission claim. This is an assessable plan, not CAS/lease
apply or final permit; transaction tests remain mandatory after owner verdict.

Current status: packet/tests preparation only; no runtime source, recovery apply,
lease/task/attempt change, provider/browser/Post, commit or deploy by this work.

### Actual verification / review

2026-10-16T18:20:19.271Z: fresh repeatable-read READ ONLY production transaction
returned solepending41 (updated15Oct19:19:42.329Z), WI1946claimed with original
lease expiry/update, events3262–3265 unchanged and zerofacts. Canonical Publisher
read after manifest/bootstrap independently returned browser_required status,
accepted/contentr1/nullasset/NVN/channel5 and unchanged body SHA above. No
prepare/normalization or other mutation was invoked by this review.

Local Node suite executes10 tests:1 fixture/setupPASS,9 expected feature-absence
RED (`same-attempt recovery decision seam is absent`), zero skips/cancellations;
no MODULE_NOT_FOUND infrastructure failure. Both fixture/test syntax checks PASS.
These are not CAS/concurrency/transport GREEN evidence. No runtime code changed,
so no new-runtime build/deployment/UAT result is claimed. The primary checkout's
existing unrelated merge conflicts remain untouched and no commit was made.

Independent reviewer `/root/dzen_boundary_slice_review` found2 P2 test defects
(missing human-message digest and redaction checked against the wrong response).
Both fixed, including negative acceptance-source/digest/ref cases. Follow-up
review and offline rerun closed both, with no remaining actionable P1/P2 in this
proposal/RED-tests scope. This is not human risk approval or send permission.
