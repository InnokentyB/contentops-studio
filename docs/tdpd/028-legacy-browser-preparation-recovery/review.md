# LOCK028 implementation review

Mode: self-review using resilient-solution-review security/resilience checklists, not an independent review or Owner/provider UAT.

Implemented boundary: common Owner preview/adopt service, registered application-only custody/profile ports, durable BrowserDeliveryRecovery reservation and request budget, existing canonical fact finalization and supervised same-attempt preparation resume. A version1 `legacy_browser_adoption_started` audit binds the historical-adoption meaning inside contract2 storage; an ordinary old NOT_DISPATCHED flag is never adopted as proof. Existing database check constraints admit only contract2, so no schema/version-bound migration was introduced.

Corrections found during review:

- Recheck all bounded start/permit/native/alternate-route history in the final adoption/fact transaction, including a late permission from an unaware writer. Recheck old lease/state before changing custody.
- Keep custom reasons in durable recovery settlement and later diagnosis, rather than reducing a historical cause to RECOVERY_CONFLICT.
- Scope fact queries by project and task at query time. Non-demo Owner checks now apply at historical reservation/request/finalization and private preparation pickup/permit/dispatch boundaries. Optional repository guard only strengthens the existing mandatory Owner check.
- Keep database-only preview discoverable with explicit missing-runtime reasons. Hide the mutating adoption tool by default; no environment switch supplies a reader or supervisor. Invalid request errors remain redacted MCP errors, while held lifecycle results remain actionable statuses.

Residual limits:

- No real Setka reader or supervisor has been demonstrated or registered. Synthetic ports cannot establish live provider coverage, exclusive custody of an old/offline browser, permissions, or absence of delayed external effects. The production mutation remains unavailable; no live task is changed by local verification.
- A pre-permit historical attempt is the entire adoption scope. Any permission, possible dispatch, unaccounted route/challenge, incomplete coverage or invalid proof stays UNKNOWN. This is not post-submit resend authority and creates no new attempt.
- Proof adoption/audit and subsequent existing resume/audit are separate atomic transactions with an intervening durable hold. A crash between them leaves verified custody held with no public lease/permission; replay must use the original operation and remaining deadline. Each failed audit rolls back its own transition; no claim of one database transaction spanning network work is made.
- Downgrading to a runtime that ignores the persistent recovery hold is unsafe. Disable adoption/pickup first, retain records and do not reset publishing/attempt state. Existing release PR198/199 remains separate.

Live admission requires the actual existing owning executor to expose supported readback and challenge-bound technical custody over every historical/offline writer. Record concrete route/denial status, complete coverage and freshness/consistency semantics, request/cancellation accounting and a separately permitted no-send smoke. Do not invent a new browser, session injection, API fallback or second sender. Human GO for the post is already recorded; no repeat GO is requested.
