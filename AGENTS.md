# Engineering agent contract

All code changes follow `/Users/innokentyb/Documents/Product/PM/PORTFOLIO_CODE_QUALITY_TDPD_STANDARD.md`.

- Read `.agents/AGENTS.md` and `.agents/rules/code-quality-defaults.md` before changing code.
- For behavior changes, define the operator boundary and write the failing acceptance test first.
- Preserve authorization, tenant isolation, audit history, publication gates, and idempotency.
- Never persist or log raw tokens, cookies, authorization headers, or provider payload secrets.
- Run `npm run quality:gate`, the focused test, and the relevant build before handoff.
- Engineering completion is not acceptance: owner UAT remains explicit.
- Existing debt is baselined; changed code must introduce no new `any`, silent catches, oversized modules, or weaker controls.
