# Engineering agent contract

All code changes follow `/Users/innokentyb/Documents/Product/PM/PORTFOLIO_CODE_QUALITY_TDPD_STANDARD.md`.

- Read `.agents/AGENTS.md` and the portfolio standard above before changing code. The former `.agents/rules/code-quality-defaults.md` path is absent; do not silently assume its contents.
- For behavior changes, define the operator boundary and write the failing acceptance test first.
- Preserve authorization, tenant isolation, audit history, publication gates, and idempotency.
- Never persist or log raw tokens, cookies, authorization headers, or provider payload secrets.
- Run `npm run quality:gate`, the focused test, and the relevant build before handoff.
- Engineering completion is not acceptance: owner UAT remains explicit.
- Existing debt is baselined; changed code must introduce no new `any`, silent catches, oversized modules, or weaker controls.

## TDPD 0.13

Read `.tdpd/core/FRAMEWORK.md` and `.tdpd/core/QUICKSTART.md` before product work.
Shape/Plan/Audit do not authorize implementation or live publication.
Approve LOCK (goal/specification), QAR (measurable non-functional requirements), ARCH (architecture) and RISK (security/adversarial review) with the human before scenarios.
Keep TRUN scenario-level results and errors for each build; GREEN requires explicit owner UAT.
Pre-sync local work is preserved in `backup/contentops-pre-sync-20261010` (stash snapshot). Reconcile individual packages before restoring them; never overwrite current provider implementations with older local versions.
