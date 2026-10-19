# OAuth acceptance scenarios — approved LOCK-025A

Surface: existing Settings, authenticated connect HTTP route, public callback HTTP route; existing tenant LinkedIn channels only. Engineering PASS does not establish provider readiness or Owner UAT.

1. Owner selects an explicit existing channel; invalid/missing/foreign/non-LinkedIn/demo/non-owner rejects with static cause/action and zero exchange.
2. Initiation emits opaque 256-bit state, separate per-attempt Secure HttpOnly SameSite=Lax browser cookie, no-store/referrer protection and exactly one durable attempt; callback URI is fixed HTTPS.
3. Missing/wrong cookie, expired/unknown state, duplicate query values and provider denial with invalid state exchange nothing.
4. Concurrent callbacks consume pending once; only winner exchanges, loser receives replay/reconnect guidance. Denial consumes valid request once.
5. Current owner revocation, channel config change, channel swap or identity mismatch cannot overwrite credentials; organization identity remains organization with verified action authority.
6. Valid callback captures actual grant/expiry/client/member metadata, encrypts token, preserves unrelated config, atomically commits credential+audit+completed; audit failure rolls back all final writes. Consumed exchange cannot retry.
7. Provider timeout/malformed response/unverified scopes/identity/config/key failure exposes no secret or provider body; issued token never reaches logs/redirect/UI.
8. Shared resolver supports encrypted verified metadata; legacy plaintext remains readable but unverified. Secret projections never expose ciphertext/plaintext, including raw_account.
9. Settings selects existing channel and distinguishes configuration/expiry/unknown grant, displays safe cause/action; no incidental creation or automatic API authority.

RED must be real Fastify route and PostgreSQL before production implementation. Synthetic provider HTTP spies only; no real LinkedIn requests. Final required checks: isolated PG race+rollback, focused credential/projection tests, backend/frontend build and unchanged quality gate.
