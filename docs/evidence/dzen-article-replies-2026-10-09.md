# Dzen article and replies release — 2026-10-09

Problem: External Radar cannot browse Dzen itself. Search cards are insufficient for article review, and the operator needs a dedicated, honest reply-discovery result.

Boundary/specification: `docs/dzen-article-and-replies-contract.md`. DZEN-ARTICLE-01: search → body read without recommendation cards. DZEN-REPLY-01: replies to our root and child comments; other discussion and Activity separate. DZEN-SCOPE-01: authorization first, tenant/channel-scoped target records, no secret exposure, no provider writes. DZEN-GAP-01: bounded/failed/unobserved reads never become exhaustive zero.

RED: executable `dzen_article_replies.test.ts` failed because `ba_dzen_read_post` was absent (after build/type corrections; not an environment failure).
GREEN: six new functional acceptance tests cover registration/roles, primary article contract, nested reply matching, authorization/sanitization, fact scope and monitor pagination/failure/time filtering. Existing Dzen tests remain passing. Production-bound isolated preflight uses the encrypted connection only in memory and installs code under `/tmp`; deployed application files are unchanged during preflight.

Native preflight 2026-10-09: ThinkingBox article body 2,841 characters/28 line segments; ContextPilot 6,776/42. Titles/authors and primary body are observed, canonical URL clean; native publication date unavailable remains UNKNOWN. Both known external threads complete within their native counters; connected-owner comment bodies observed; zero external replies in those exact loaded threads. Owned Studio inbound zero; three historical Activity likes; unread before/after unchanged (0/0). No live positive child-reply fixture; covered by functional contract tests only.

Engineering acceptance does not replace owner UAT. Deployment and independent Radar results are recorded below after verification.

Verification: backend build PASS; 197/197 focused Dzen/VK/auth/role/workspace checks PASS; repository quality gate PASS (baseline score 77, floor 77, hard stops absent; portfolio target 90 remains existing debt). Full test suite was not rerun: this slice adds bounded readers and role entries, without refactoring existing modules.
