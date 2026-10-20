# OAuth verification diagnostics

LOCK/QAR/ARCH/RISK: owner approved finishing the proposed stage-specific OAuth diagnostics on2026-10-20 (“погнали тогда доделывать”), after the failure and missing card identity were explained. Scope is diagnostic repair and safe presentation inside the existing channel. It does not authorize another OAuth exchange, enabling publication, credential fallback or relaxing verification.

Boundary: human completes the existing browser-bound OAuth; Planner verifies exchanged token, introspection, identity and organization. Replace generic GRANTS_UNKNOWN for new failures with finite, actionable codes. Keep historical generic failures honest. Read-only channel status exposes only safe metadata of the latest same-tenant/channel attempt, never state/code/token/browser hashes or provider responses. Show that failure and its date in the channel card; offer its validated expected author as an editable draft, explicitly not a verified binding. User edits must not be overwritten by delayed status reads.

QAR: distinguish HTTP/exchange response, inactive token, absent/mismatched client, missing/invalid/expired expiry, missing/malformed scopes, absent profile grant and malformed profile identity. No raw tokens/authorization/provider bodies in API, callback, logs or UI. All old guard denials still prevent credential writes. Maximum provider response64KiB/15s and fixed destinations remain. Existing channel ownership/demo protections and same-origin browser-cookie flow remain. Latest-attempt status retrieval must select only explicit safe columns and exact project/channel/provider/purpose; bounded newest1 record. Existing fields and stored history remain compatible.

ARCH: small provider-validation helper, finite diagnostics in existing error catalog, safe status projection over existing attempt table, and bounded UI status parser/presentation updates. No schema or grant change. No OpenID substitution or weakening of required authoritative identity/grant evidence. Separate current stored-credential status from last attempt outcome; a later failed reconnect must not erase an earlier valid connection. Never infer the old failure's exact cause retrospectively.

RISK: fail closed on missing optional provider fields required by this system; label missing evidence precisely rather than accepting it. The LinkedIn introspection spec permits absent scope/client/expiry, but this governed route requires them; no fabricated metadata. Historic expected author is a draft hint and is revalidated by the original connect boundary, not publication authority. Unknown stored error strings are discarded. Response shape is additive; old consumers keep their fields. Causal RED first, focused unit/real synthetic HTTP+PG tests, quality gate, backend/frontend builds and browser-state checks in Docker. Owner UAT and explicit release approval are separate; no production action is part of tests.

Sources checked2026-10-20: https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection and https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api .

## TRUN — synthetic Docker verification, 2026-10-20

- Causal RED: 12 stage-diagnostic cases failed against generic provider errors; newest exact-channel status case lacked latestAttempt; UI parser case lacked latestAttempt.
- Implementation validation initially exposed a frontend import-order ReferenceError in the VM harness; corrected the static import to the module top before rerunning.
- GREEN: 22 provider/UI/origin cases; 32 real HTTP + PostgreSQL OAuth cases, including exact-channel latest attempt and no credential/history mutation; backend TypeScript/Prisma and frontend TypeScript/Vite builds, including built same-origin contract.
- quality:gate PASS, score77 (existing accepted baseline), no hard stops and no new runtime-policy debt.
- Impeccable detector: no findings. Sandboxed Chromium at1280px and360px: no overflow or page errors, controls at least44px; precise failure, editable prefill, preservation of edited draft, safe403 and non-owner states verified. Synthetic fixture only; no live OAuth/provider mutation.
- Additional API regression invocation first used nonexistent filenames, then the actual glob required the existing synthetic TELEGRAM_BOT_TOKEN setting; those environment errors are not product RED evidence.
- GREEN with the required synthetic environment: all14 compiled API adapter, legacy-route closure and disabled-gate regression cases.
- Production is unchanged. Owner UAT and release approval remain pending.
