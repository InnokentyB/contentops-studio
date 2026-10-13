# Owner amendment to LOCK/QAR/ARCH/RISK-VK-017: governed VK route

2026-10-13, Europe/Lisbon. Applies the verified human route instruction in
Portfolio HQ turn `01a1354f-36ec-7562-a124-e369cc491ab8`, user message
`01a1354f-396c-76d0-9ce5-424e35ea18a9`:

> «не пытаться открыть ВК через… Quagetta, только через планер и независимый адаптер»

This tightens the existing approved017 independent-adapter architecture. It adds
no provider route, credentials, publication approval, task, lease, permission or
browser surface. LOCK/QAR/ARCH/RISK/AUT-017 continue to govern the same package;
this amendment does not manufacture approval of a new execution architecture.
The canonical operating rule is `docs/operations/vk-owned-publication-route.md`.

Operator boundary: all governed VK owned-publication control, execution and
preflight use documented Planner commands and the registered independent adapter.
Codex roles never use CUA/ComputerUse, private tabs, CDP/session injection or a
browser/API/worker/chat fallback. Failed or unavailable adapter returns a fixed
BLOCKED repair instruction. Existing action/site denials remain applicable;
UNKNOWN/started/uncertain cannot cause a resend. Human operator handoff is separate.

Measurable tightening: zero generic VK browser/API dispatch/fallback calls and
zero task/work-item writes when the registered route is unavailable; zero provider
operations on a wrong production route; all seven role bootstraps carry the same
rule. Existing017 timing, ownership, hashes, confirmation and no-retry guarantees
are unchanged. Passive managed startup remains passive.

Architecture: a small shared route contract; minimal delegation from the existing
publication selector/dispatcher; a production-runtime route stamp checked before
admission; one shared bootstrap instruction. Dispatcher is already907 lines:
this change must not grow its routing logic. Extract logic into the new contract,
use only small boundary guards/platform arguments, preserve unrelated providers.

Risk/rollback: guard metadata is not proof of permission, registration health or
DOM. Current explicit community denial is not lifted. Do not mutate #1048 or
historic WI1699, jobs, receipts, attempts, facts, releases or lease data. No migration.
Reverting the new code must not remove the owner rule or restore a VK browser
fallback; preserve safe blocked behavior and all publication history. No provider
UAT or runtime activation is authorized by this amendment. Report policy written,
code enforced, build/test/CI, deployment and human UAT separately.

Reviewed additional task-facing boundaries: TelegramTaskPublicationService,
Publisher facade/VkPublisher, direct MCP publishing and legacy post scheduling/
manual/reset. Their old direct VK publication expectations are intentionally
replaced by adapter-only blocked outcomes; raw transport tests remain unchanged.
Oversized legacy modules receive only boundary delegations. Scoped effective
channel resolution is extracted into `publishers/legacy_publication_channel.ts`.
A missing/foreign explicit binding is held; only truly unassigned legacy posts
may resolve their existing Telegram default. If a binding disappears after a
valid legacy batch claim, retain it for repair without send/default/reset; this
is not a new claim of canonical017 race atomicity. No publication data is changed
by implementing or testing this amendment.
