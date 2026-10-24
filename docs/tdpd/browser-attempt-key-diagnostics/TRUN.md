# Original-attempt key diagnostics — 2026-10-24

Operator boundary: existing shared-browser attempt validation and MCP error serialization. Confirmed failure: a caller used a new per-stage preSubmit key while the delivery attempt retained the original start key. No key value or business identifier is embedded in runtime code.

Authority: Owner directed precise diagnostics/contract correction while preserving exact original-attempt binding, no new attempt, no risk acceptance or send. This correction does not alter successful admission. Historical same-attempt recovery remains separately governed by existing LOCK028 and actual owning-executor custody/readback; no new live executor admitted here.

RED: browser-attempt-key-diagnostic.test.cjs,3fail/1pass against main37af554. Failure was absent precise serialized key/scope/history reasons, not infrastructure.
GREEN: new4cases pass; combined execution/confirmation/diagnostic regression25pass/0fail. Includes successful original key, wrong scope without invented downstream reasons, independent key/state/count failures, actual operator serialization with single boundary log, absence of raw keys/approval references and no writes on denial.
Docker backend build passes. Docker npm run quality:gate PASS77, no hard stops/no new runtime debt (6823 accepted baseline). No frontend change or schema/data migration. Owner/provider UAT and production release pending.

Implementation keeps top-level BROWSER_RECONCILIATION_REQUIRED for compatibility. A tenant/task/channel-scoped row is read before its key/status are checked; all previous success conditions still apply. Failed key, pending state and attempt history produce static structured reasons. A missing row does not inspect a foreign scope or infer its values. Typed error contains no supplied/stored key, lease, approval or provider body. MCP contract explicitly requires the immutable original start key and explains expired-lease recovery.

Rollback: revert this code-only change to restore old generic diagnostics; no state is created or removed. Never reset historical leases, attempts or persisted recovery holds. No real OAuth, provider read/write, permit issuance or publication performed by these tests.

Final rebuilt image includes updated MCP contract. Final combined run37/37PASS includes actual registered MCP and publisher/principal capability checks plus compiled actionable-diagnostic tests. Diff whitespace checkPASS. Final backend image config1a8873b24d38d35ecba65b4e57a8b818b3931384ff71d10a07d19c6f86ae35e0.
