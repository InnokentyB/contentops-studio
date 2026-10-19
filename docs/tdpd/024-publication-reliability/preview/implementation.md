# REL-03 local implementation

Owner approved the five LOCK/QAR/ARCH/RISK packages on 2026-10-19. This package is local engineering work; no production activation, provider calls or public export.

`ba_preview_publication_task` is a separately registered Owner/Publisher read-only MCP tool. The authenticated remote session principal is closed over by the server; caller arguments cannot replace it. Project membership and task scope are checked before reading the local package. Other profiles cannot discover the tool.

The repository uses a bounded repeatable-read PostgreSQL transaction with `SET TRANSACTION READ ONLY`. Prisma selections exclude channel configuration, asset URLs/provenance and report payloads. A fixed parameterized SQL expression projects publication-hold truthiness only. No provider, sender, credential resolver, lease acquisition or fact mutation is invoked.

The result contains safe local metadata, independent actionable blockers and correction steps. Provider/credential/release readiness and asset durability remain explicitly unverified. The local metadata digest is not a release manifest or send permit. Existing attempts require reconciliation; local validity never authorizes submission.

Initial actual-SDK acceptance run reproduced the missing tool (10 failures/1 pass). Implementation passed 18 acceptance scenarios, then independent review reproduced four lifecycle/hold/art-binding gaps. The fixes split known handoff, status and publication-hold causes, bind art decisions to channel/placement and expand the consistency digest. Current source SDK/auth suite: 35 passed. Separate real PostgreSQL verification and final exact-source build are pending at this checkpoint; earlier backend/frontend build and quality 77/7096 passed. Final results belong in TRUN, not inferred from this checkpoint.

Final package verification: six real PostgreSQL scenarios passed, including actual read-only DDL denial and malformed report handling. Final exact-source backend/frontend build passed (`planner-reliability-preview:20261019`, image `377feb5ecfdb`); mandatory quality gate passed at77/7096 with no added runtime debt. Combined integration verification is separate.

Owner UAT remains pending. No UI or external client permission setting is changed by adding a read-only annotation.
