# LinkedIn connection same-origin repair

LOCK/QAR/ARCH/RISK: owner requested correction after confirmed production evidence and explanation of the same-origin fix; explicit instruction “Исправляй” on 2026-10-20. This bounded repair restores the existing intended connection behavior, separately from the proposed visual redesign. No provider admission, OAuth consent or publication is authorized.

Owner boundary: status lookup and connection initiation from the current Planner page. Both requests must use relative `/api/auth/linkedin/` URLs, regardless of absent or stale VITE_API_URL. Existing API client uses relative routes and Vite proxies /api for development. No separate API-origin configuration is necessary for these cookie-bound, same-origin OAuth routes.

QAR: zero requests to localhost or another origin for these two endpoints; preserve bearer authorization, selected project/channel, expected author and credentials/include for initiation. Production build must automatically check its emitted Settings JavaScript for these routes and prohibit explicit HTTP origins attached to them.

ARCH: change the two fetch URLs in LinkedInConnectionControl only; add component-execution acceptance tests and a post-build artifact check. No backend, database or dependencies change. Preserve owner/demo authorization and browser-bound callback. RISK: a remote API override previously allowed bearer transmission to a different origin and broke browser cookie binding; removing it keeps tokens on the Planner origin. Local development continues through the existing proxy. No real accounts, cookies or tokens in verification.

Scenarios: unset API origin, historical localhost setting, foreign configured origin all produce same-origin status and connect requests; preserve authorization/query/cookie options and redirect to server-issued OAuth URL. Build artifact validation requires both routes and rejects absolute HTTP origins on their fetch targets. Verification runs only in isolated containers, without provider access. Human UAT and release remain separate.
