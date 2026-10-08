# Dzen inbound production preflight — 2026-10-08

Base: main `227286bc5555c75a7cb53fd77c28c3b9065b6704`. Isolated managed worktree; unrelated original-checkout connector changes excluded. User requested productive Dzen comments/activity/replies and had authorized production deployment and checks. No outbound authorization inferred.

RED: `ba_dzen_read_inbound` operator scenario failed because native readers were absent. GREEN: backend build; 100 focused/related Dzen, VK regression, MCP authorization/profile and workspace-manifest tests; quality gate PASS, baseline score 77, no hard stops. This does not achieve the portfolio audit target 90. No unrelated god-file decomposition, schema migration, credential rotation or public write.

Final compiled reader was run in an isolated temporary directory against the authorized production runtime, without replacing application files. Channel 116/project 10:

- Publisher identity and native `canRead` verified.
- Native Studio comments empty; observed bounded zero, one page, exhausted. Missing/failed reads never substitute zero.
- With two explicitly known public threads, Activity returned three events: two `comment_like` and one `pub_like`, dated 2026-09-22, 2026-09-10 and 2026-09-07. These are historical events, not new activity on October 8.
- Known public thread `https://dzen.ru/a/apFTbWni3D3wa4Ne` returned full actual connected-owner comment `3482648074`, native time 2026-09-09T12:12:02.102Z; one root, native child count zero.
- Unread counter zero before/after; every mutation request blocked. Opening the native bell normally attempts `POST /api/bell/notifications/seen-until`; the reader never dispatches that write and fetches only list/count GETs.
- Native CSRF/fingerprint headers remain page-local in memory, never output. Public reader requires the observed `static.dzeninfra.ru` asset host. No provider secrets in evidence.

Limit: live nonzero child-reply fixture was unavailable in checked owned/known threads. Native child schema/endpoint was verified from the public provider frontend; focused functional tests verify loaded child bodies and root/direct-reply scoping. Public root/child history beyond bounded initial lists is not automated.

Next gate: merge the exact passing revision, verify both Railway services on the merge commit, run published token-bound tools, and ask the existing External Radar chat for independent verification. Human owner UAT remains pending.

Rollback: revert this isolated reader slice and redeploy normally. No production data/schema rollback required.
