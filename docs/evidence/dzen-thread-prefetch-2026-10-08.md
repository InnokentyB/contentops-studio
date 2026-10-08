# Dzen known-thread preload repair — 2026-10-08

Independent External Radar verification of PR #60/main `ce5969bf3e7bad1a464535ac4a891f6c3a1dcbac` correctly found the second known thread UNKNOWN/interface_changed. Studio and scoped Activity passed; first known thread passed. No false-zero or outbound/read-state write occurred.

Actual native observation: the shorter ContextPilot publication automatically fetches `/api/comments/v2/root-comments` during navigation, before the explicit comment-control click. The response is valid and contains comment `3477967072`; waiting only after navigation misses it. RED regression reproduced this exact operator failure (10 pass, 1 fail because DZEN_THREAD_INTERFACE_CHANGED).

Repair arms response capture before navigation, matches the exact native document ID derived from the observed `/a/` or `/b/` publication permalink, and requires the main frame. The regression rejects a foreign native document and checks body/child count/browser cleanup. Native legacy `/media/` links remain an explicit unsupported mapping.

GREEN: backend build, quality gate PASS (baseline 77, no hard stops), 191 related Dzen/VK/MCP/auth/manifest tests. Isolated final compiled reader checked both known threads in the production runtime:

- `https://dzen.ru/a/apFTbWni3D3wa4Ne`: connected-owner comment `3482648074`, full body, 2026-09-09T12:12:02.102Z, native replies zero.
- `https://dzen.ru/a/apVsRPWX808c-DY-`: connected-owner comment `3477967072`, full body, 2026-09-09T12:12:33.550Z, native replies zero.

Both exact native threads complete within their returned provider counts. Full Dzen coverage remains bounded; no live nonzero child-reply fixture was available. Production MCP rollout and a second independent Radar check follow this repair. Owner UAT remains separate.

Rollback is revert of this small reader/test/documentation repair and normal redeploy; no schema/config/data change.
