# Final scenarios: VK1048 provider delta017

Date: 2026-10-13, Europe/Lisbon. Input: owner-approved LOCK/QAR/ARCH/RISK/AUT-VK-017.
Operator boundary: Publisher command and existing standalone consumer, only the
existing project10/task1048/channel117/feed job, accepted revision1/asset130.
An offline test result does not permit provider execution or replace owner UAT.

## Admission before any provider action

The recorded Browser Use site-safety denial remains binding for the affected VK
browser operation. Its provenance is the 2026-10-08 Browser Use rejection; it is
not a newly observed failure on 2026-10-13. Owner GO, an environment variable,
config file, caller-provided permit, or an application-generated signature cannot
remove that restriction. No presently available trusted policy authority supplies
an action-time allowance for this route.

Production admission must therefore reject before opening the private profile,
constructing a provider client, navigating, or checking login. Future admission
requires a genuinely trusted platform decision bound to the affected action,
job/package, project/community, host instance/generation and validity interval.
Application input must not masquerade as that decision. Allowing mocks are solely
synthetic dependency ports in offline tests and must be unreachable from config,
environment, LaunchAgent settings and remote MCP arguments.
If the historical denial's exact applicability to the proposed action cannot be
established, report ADMISSION_UNAVAILABLE/EXECUTION_CONTEXT_UNVERIFIED and retain
that history. Do not describe it as a newly observed denial of task1048.

## Observable scenarios

| ID | Trigger | Required observation |
| --- | --- | --- |
| VK017-01 | Owner GO or provider mode is requested without trusted action-time admission | Historical denial provenance retained; POLICY_DENIED only for an established affected action, otherwise ADMISSION_UNAVAILABLE/EXECUTION_CONTEXT_UNVERIFIED; zero profile opens, provider constructors, navigation, login, reconciliation, upload or submit |
| VK017-02 | Caller changes job, project/channel/community, accepted revision, selected asset, package/release hash or transport generation | No admitted execution package; no canonical claim, attempt, fact or provider mutation |
| VK017-03 | Existing valid canonical publication fact is present | Return that exact fact without a new upload, send, synthetic attempt or duplicate checkpoints |
| VK017-04 | In an offline admitted fixture, independent inventory yields one exact existing post | Correct owner/object/permalink, accepted caption, precise provider time and approved-image identity are mandatory; guarded reconciliation creates one fact and no synthetic send attempt |
| VK017-05 | Complete scoped inventory proves absence and canonical attempts are absent | Only after permission and immutable-package recheck may the existing lease mechanism claim WI1699; durable attempt precedes one upload/submit |
| VK017-06 | Inventory is incomplete/ranked, budget is exhausted, date is ambiguous/relative, media identity is missing, or multiple exact candidates exist | UNKNOWN with a specific coverage/date/media/ambiguity blocker; zero claim-to-send transition, upload, submit or publication fact |
| VK017-07 | Two consumers race, WI lease is expired, or an older instance/generation continues | Existing claimWorkItem CAS determines the canonical lease; transport generation is bound to that lease, old execution is fenced before upload, submit and confirmation; no direct WI reset |
| VK017-08 | A started/uncertain attempt exists, including after restart or rollback | Reconciliation only, even with another idempotency key; no automatic retry, new allocation/upload/submit or available-state reset |
| VK017-09 | Upload/submit may have happened but response/confirmation is lost | Record uncertainty, retain attempt and safe transport stage, freeze resend; repeated command or consumer restart cannot duplicate delivery |
| VK017-10 | Exact new post readback is available | Independent absolute provider time, canonical object/permalink, exact caption/community and provider-backed approved-image binding precede guarded fact transaction; local hash/image_present/click/screenshot alone are insufficient |
| VK017-11 | Task, release, selected asset or either lease changes between inventory/claim/upload/confirmation | Recheck at every consequential boundary; no stale fact and no continued mutation under expired or superseded authority |
| VK017-12 | Permitted future context reports login/challenge, dependency unavailable or policy denial | Distinct NOT_CONNECTED/LOGIN_REQUIRED/challenge/POLICY_DENIED status; no guessed login requirement, credential/session extraction, alternate browser or API fallback |
| VK017-13 | Provider/MCP errors include raw tokens, headers, cookies, signed URLs or payload fragments | Persist/return only allow-listed blocker and scoped non-secret IDs/hashes; private local artifacts remain private and sessions/connections close on failure/shutdown |
| VK017-14 | Existing infrastructure consumer/readers observe new provider states, then rollback stops provider | Compatible readers preserve original receipt/audit/job and any uncertain attempt; no deleted history, DROP, resend reset or rollback to an incompatible state reader |
| VK017-15 | The same owner command is repeated concurrently or after successful reconciliation/confirmation | Same job/package and canonical fact returned; at most one provider send and one set of canonical measurement checkpoints |
| VK017-16 | The actual standalone bundled consumer executable starts without a usable config | Reach its own sanitized configuration/admission boundary without SDK/module initialization crash; zero profile/provider/credential access. Build success alone is insufficient |

Reconciliation has a 120-second/100-object ceiling; exhausting either returns
UNKNOWN. Metadata/navigation operations are bounded to 30 seconds. A complete
inventory claim requires a defined target/time scope and independent coverage
evidence; absence cannot be inferred from an empty DB attempt list, one old date,
news search, body-only matching or an arbitrary provider page.

## Verification and release interpretation

Each RED/build attempt records command, revision, scenario-level result, errors
and skips in `docs/evidence/vk1048-provider017-trun-2026-10-13.json`. Parent
integration supplies focused tests, backend/frontend builds, quality gate,
database concurrency evidence and final review. Cases whose trusted policy or
provider evidence dependencies are absent remain blocked; they are not a live pass.

Reviewed code deployment may prepare the integration while provider admission
remains denied. Scoped real-provider smoke and owner UAT are separate outstanding
gates. No statement of production publication follows from fixture GREEN.
