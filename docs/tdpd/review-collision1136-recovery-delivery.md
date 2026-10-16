# REVIEW-COLLISION-REPAIR-002 — implementation / operator boundary

Owner-authorized engineering recovery, relayed by p7 Planning
`01a06dbc-6687-77e0-a14c-33cde5963961` on16Oct2026. Scope: preserve exact task1136
r2, channel6/company97416172, body/date/history; recover Editor collision and
manual-only projection. No release, send, provider contact or automatic approval.
LOCK/QAR/ARCH/RISK follow the existing reviewed recovery proposal: dynamic exact
snapshot, serializable CAS, immutable history, one replacement, tenant/owner and
idempotency fences, audited rollback-preserving recovery. Owner image approval is
separate from content acceptance and governed Art ingest/binding.

## Operator tool

`ba_get_content_review_repair_snapshot` provides server-computed expected hashes
through MCP without raw body/config/review export or out-of-band database access.
Call it with project/task/old WI/actor; all owner/tenant/current collision gates
apply. Verify returned body/revision/channel/dates against the approved package.
Then pass its expected_snapshot to `ba_repair_content_review_handoff` with the
owner reason and stable key, first preview, then explicit apply.

`ba_repair_content_review_handoff` (owner and scoped Editor profile; authenticated
actor is overwritten by MCP principal). Preview default `apply=false`; apply
atomically supersedes the collision WI as completed without rewriting result,
note, reason or approvals, creates one available content_review at context=current
revision/result0, and replaces only quality_report.handoff_bundle using the
canonical builder. Other quality-report fields stay unchanged.

Arguments bind project/task/channel/revision, body SHA256, schedule/publish dates,
old WI/result version, channel-config SHA256, task-metadata SHA256 and old-review
state SHA256, reason and stable idempotency key. Metadata hash covers assets,
quality_report (including task identity), metrics, visual state/mode/decision
version/selected asset. Review hash covers result_payload/note/reason/context/
result/lease expiry and scheduling/dependency fields. Task title/type/layer/
item_key/placement and channel id/project/name/type are also snapshot-bound.
Non-null review prerequisites block rather than silently creating available
work without its dependency. Only hashes, old note/reason, IDs and bounded reason enter
audit; channel config/body/secrets are not copied into the audit. Obtain exact
hashes through the new safe snapshot read, not provider access. Missing/current
snapshot drift, competing review, active lease, non-owner, attempts or fact block.
Same-key exact replay returns the same replacement, changed input conflicts.

First case: p7/task1136/WI1948/rev2, accepted=null;
body SHA `e73f0ad672eeabf4d93a947a33d727678731bc9d2133d52a50cf0e3c97cd6692`;
both dates `2026-10-16T14:00:00.000Z`; historical approval368 and Art decision321
remain untouched. Approved picture SHA
`5d6896f4cd6fa249df6227e56f7cf13f4f13c710cad57c68e6cafcaeb59815d6`
is NOT attached or approved by this repair. Art must bind it to accepted r2 after
actual Editor acceptance; NO_VISUAL_NEEDED is not the current owner request.

## Shared causal fix / compatibility

Placement contract now narrows connector_authority to manual_only when explicit
nonempty channel.execution_modes contains only manual/browser modes. Stale
capability_flags.api_publish=true cannot widen it. Unspecified/API-capable
channels keep existing placement authority; an already manual-only placement is
never widened. Both imported/generated canonical handoff and prepare consume the
same transport contract. publication_mode=approval_required and release gates
remain unchanged. This code grants no API/browser publication route.

## Verification and rollback

RED: task1136-shaped generated handoff returned automated despite manual-only
channel. New repair service was absent. Focused tests cover immutable history,
preview, replay/conflict, tenant/body/identity/config/review drift, existing
attempt/fact/lease and rollback. Real PostgreSQL concurrency/rollback runs only
against explicit ephemeral loopback CI database; never local production env.
Independent review found original-note/reason loss; fixed by retaining both
fields and binding old review/metadata snapshots. Fresh review/checks and exact
deployment/readback are recorded separately, not inferred from this document.

Rollback disables/removes the new repair tool while preserving historical
supersession, replacement, audit and any later Editor/Art results. Never delete
approval368 or reset a claimed/reviewed replacement. Human UAT remains explicit;
an engineering metadata readback is not owner acceptance or publication readiness.
