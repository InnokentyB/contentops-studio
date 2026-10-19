# Local integration review

Owner approval on 2026-10-19: five LOCK/QAR/ARCH/RISK packets for synthetic tests and local implementation; MEMORY-001 separately approved. No public export, production migration, activation, provider operation or deploy.

Root integrates six isolated branches onto deployed baseline `3fd625a3b5ecce44fd6956ec0d1355e5ed3ff3e4`. Existing Tower-development checkout and unrelated local operations files are preserved. MEMORY/preview remote-session merge retains both operation drain tracking and the authenticated session principal. Capability registration retains both preview and Threads reconciliation without changing older provider allowlists.

Independent reviews produced reproducible fixes, rather than acceptance exceptions:

- Preview: local hold/lifecycle checks, decision channel/placement, trusted principal and secret-free database projections. Actual PostgreSQL enforces READ ONLY even when a dependency attempts DDL.
- Threads: original recovery lease expiry checked immediately before commit; provider IDs survive subsequent authority changes; exact original release dates/decision/visual/account package checked before side effects and confirmation; failed persistence of uncertainty has a static actionable error. Known-provider GET bodies are capped at 1MiB and redirects refused. Official media readback uses `TEXT_POST`, distinct from creation's `TEXT`.
- Preparation: general writer bypass replaced by an explicit transaction-local first-permit purpose; technical ledger moved out of user-editable project settings into an additive protected model; active readback lease/deadline survive repeated result callbacks. Shared guarded finalization must complete the ledger atomically for both browser and API-reader paths.
- Visual: source/generation/review callbacks bind to current server-owned generation and decision. Current locked asset data controls review. Generic work completion cannot consume a required typed art/review step. Request-versus-content-edit and request-versus-release races are included.
- MEMORY: independent review preserves identity/session boundaries, active disconnected operation drain and exactly-once resource cleanup. Synthetic session counts return to zero; no RSS savings claim.

Known PostgreSQL serialization conflicts now return `BROWSER_STATE_CONFLICT`: refresh current lifecycle and reconcile existing uncertainty, never infer permission to resend. RED reproduced one missing classification (8 existing tests passed, new test failed); GREEN passed all nine. Unknown SQL errors retain the unknown-cause projection. Only typed Prisma P2034 or P2010 with exact SQLSTATE40001 is classified; raw SQL/messages never enter the response.

Exactly three obsolete baseline entries are removed after source review: two fixed-tenant comparisons in the shared Threads route and one unchanged visual review protocol enum. No new exemptions, scanner changes or blanket baseline refresh.

Combined exact-source Docker build, mandatory quality gate and acceptance results are recorded separately in the final integration TRUN. Package-only runs do not substitute for these checks. Owner UAT is pending even when engineering checks pass.
