# DZEN-ADAPTER-LIFECYCLE-001 final offline scenarios

Status: authorized for RED and implementation. Approval: direct human reply
01a14e87-3d81-7e80-841c-173c9e95d4af, Portfolio OS turn
01a14e87-3b87-7323-a454-6a9e92b1808f, questionItemId
["request_user_input_async","call_bbefdc69adce4330a7981d9eca597448",0].
Exact approved plan SHA256 d00e091cacdf9ffed1801fc0c2c961e9086c63c86dc3e0074db1330cb9bec37e.
Companion receipt records direct approval; original approved plan bytes retained.

Actor: authenticated scoped owner or executor. Boundary: existing
ba_publish_publication_task and shared dispatcher, actual principal scoping,
canonical Prisma lifecycle and registered independent adapter. All fixtures are
synthetic and isolated. No real task/release/attempt/fact mutation or provider call.

| TR-ID | Preconditions → action | Required observable output/state |
| --- | --- | --- |
| DA01 | Valid package, dryRun omitted/true | Stored diagnostics only; no provider/browser/release/job/attempt writes. |
| DA02 | No trusted principal, forged actor, foreign tenant | Reject before protected reads/provider/writes. Real remote context overrides caller identity without requiring actor argument. |
| DA03 | Publisher credential + release apply | Denied despite ability to call base command; no release. |
| DA04 | Owner + current exact package + release apply | One immutable release/WI/job; no provider or attempt. Same key replays, changed payload conflicts. |
| DA05 | Two unrelated valid task/account packages | Same generic code succeeds as data; no added functions/allowlist IDs. |
| DA06 | Stale revision/manifest/account/asset/schedule, role revoked | Block before claim/mutation; no silently rebound approval. |
| DA07 | Mixed existing unversioned VK and versioned Dzen jobs | Filter before decode on every lookup/claim/CAS; no poisoning/starvation/foreign update. Cross-provider key collision conflicts. |
| DA08 | Released eligible package, complete published+draft inventory | One claim/start before first native mutation; one Submit fence; independent exact receipt before fact. |
| DA09 | Partial/unknown/looping/limited inventory or duplicate | BLOCKED; no absence proof/claim/Submit. |
| DA10 | Missing/not-ready adapter or unresolved policy | Terminal blocked, no generic browser WI/direct transport/fallback. Production restriction stays held. |
| DA11 | Concurrent same/different send keys and old/new writers | At most one started attempt and Submit; repeat returns original/reconciliation only. Separate PostgreSQL processes/transactions. |
| DA12 | Changed package/revision/key after prior attempt | No new attempt/job/send. |
| DA13 | First mutation/Submit/response interruption | Preserve original claim and freeze; no automatic resend/cancel-to-reclaim. |
| DA14 | Receipt arrives after current owner/manifest/eligibility drift | Internal custody commits against original claim before completion; no loss of evidence, fact access checks remain. |
| DA15 | Fact transaction/DB fails after retained receipt | Receipt remains; subsequent original-attempt reconciliation completes atomically without native mutation. |
| DA16 | Conflicting/forged receipt/fact, foreign account/body/cover/time | No canonical success; retain conflict without overwriting. |
| DA17 | Legacy attempt without job, valid stored receipt | Original attempt/fact/audit only; no synthetic job/release/attempt/key/lease reset. |
| DA18 | Legacy UNKNOWN/multiple ambiguous histories, receipt missing | Frozen/reconcile only, even if inventory appears empty. |
| DA19 | Canonical confirmed result replay | Current access check; original result, no provider/fact duplication. |
| DA20 | Manual MCP/REST/import confirmation or automatic mode flag | Generic ownership fence blocks caller-created facts. |
| DA21 | Import/materialization/repair/content/status updates | Preserve history/ownership; resetting status/quality cannot permit another claim. |
| DA22 | Actual independent child + sandboxed local fixture | Registered port owns browser; published AND draft pagination, edit/upload/one Submit/readback verified, no external request. |
| DA23 | Malformed/oversized IPC, forged registration/process/lease/generation | Reject before effect; no arbitrary transport/session/test-root selection. |
| DA24 | Asset redirect/digest mismatch/size cap, malicious page/network | Block and sanitize; no secret logging or SSRF. |
| DA25 | Browser/page/process cancellation or limit/timeout | Bounded cleanup; immutable uncertainty retained; no retry grant. |
| DA26 | Rollback/disabled new admission | Keep receipts/history/reconciliation; no old send fallback or sandbox disabling. |
| DA27 | Non-Dzen existing calls | Existing semantics preserved; unsupported new operations reject; VK/X/Threads/browser regressions pass. |

Acceptance suites must exercise these behaviors via real boundary/service calls,
not source-text assertions alone. Lower-level schema/queue tests supplement them.
RED must be missing behavior, not missing dependencies. Record runner errors
separately. Each build records exact source snapshot, command, timestamp, result
and failures/skips. No skipped required test counts as GREEN. Quality gate and
relevant backend/frontend build are required. Human/native UAT and production
activation are separate release gates; synthetic GREEN does not clear UNKNOWN
applicability of original1045 denial to1002.

Execution readiness: owner approved full LOCK/QAR/ARCH/RISK; source work is
isolated in codex/dzen-adapter-lifecycle. Tower jobs only Docker. No migrations,
production DB, credentials, background consumers or live provider access. Existing
models and reviewed Compose controls are reused; any needed material exception
is reported, never silently weakened. Independent final review is mandatory.
