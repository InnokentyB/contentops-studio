# Dzen native search title regression — 2026-10-09

During production verification of PR #63, search returned valid ranked URLs but blank titles. The native search card starts with an empty image anchor, while the visible title is a sibling `data-testid=card-article-title-link`; it is not h1/h2/h3. Existing extraction deduplicated the image URL before reading the actual title.

RED: functional browser-evaluator regression reproduces empty image anchor + sibling native title + second permalink. Existing code fails `title === expected` with actual empty string. GREEN: select the native title inside its exact card, skip untitled links before deduplication, strip tracking and fragments before URL deduplication, enforce exact HTTPS host. Recommendation/feed-wide ancestors are not used.

Module size reviewed: existing puppeteer publisher facade was 994 lines, with substantial pre-existing debt. This correction adds only native read selector/URL boundary handling (no publication extension); file remains under 1,000 lines. Broad publishing decomposition is deferred to avoid unrelated behavior changes; public API remains identical. No source-contract tests inspect this search method. Focused functional evaluator, backend build and quality gate required before release.

GREEN: backend build PASS; 207/207 related checks PASS, including the search regression; quality gate PASS, score77/no hard stops. Existing facade is 998 lines after this bounded correction.
