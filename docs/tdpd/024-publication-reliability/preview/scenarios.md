# REL-03 approved acceptance plan

Owner approved LOCK/QAR/ARCH/RISK in the coordinating chat on2026-10-19: “Утверждаю пять пакетов”. Authority: synthetic tests/local implementation; no production/export permission.

Boundary: real MCP SDK discovery/call serialization, trusted per-session principal, read-only transaction and field-constrained Prisma repository. SDK tests use a deterministic fail-on-write/no-secret-read database adapter; PostgreSQL read-only semantics are separately enforced by the production repository's explicit READ ONLY transaction.

| ID | Actor/precondition | Action | Observable pass condition |
|---|---|---|---|
| P01 | Publisher with accepted text-only task | List tools/call preview | Read-only annotations; local checked snapshot, provider NOT_CHECKED, no submission permission or writes |
| P02 | Same principal; caller spoofs actor/project | Preview | Caller actor ignored/rejected; token project mismatch denied before data; no foreign task fields |
| P03 | Missing principal or wrong profile | Preview | Specific access denial, no DB query |
| P04 | Membership absent or missing task | Preview | Safe access/not-found error; no raw provider/DB error |
| P05 | Selected asset approved/stale/wrong tenant/current decision changed | Preview | Exact local blocker and supported correction; no file/config/provenance secret read |
| P06 | Pending/uncertain attempt or active publishing lease | Preview | Reconcile/current owner action; no retry/new key suggestion |
| P07 | Dzen/VK or unsupported provider | Preview | Independent route NOT_CHECKED or unsupported; no fallback/provider probe |
| P08 | Expected revision/package digest stale | Preview | Stale binding blocker, current send authority never inferred |
| P09 | DB unavailable/invalid request | Preview | Safe actionable bounded error, secret marker never serialized/logged |
| P10 | Real role-filtered server | List/call | Owner/Publisher only; existing live annotations remain destructive/open-world |

Build/gate: existing Docker compiler and quality baseline77/7096; real MCP SDK must pass. Manual UAT after separately approved release: preview works through client's permitted read boundary and reports actual blockers without implying provider readiness. External policy may still deny a read tool; do not claim its settings fixed.
