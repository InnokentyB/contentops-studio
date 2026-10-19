# LinkedIn generic channel settings boundary

Owner approved design 025 and root assigned this narrow implementation. No live provider, production credentials, publication, deployment or external writes.

Actual Fastify POST/PUT routes with isolated PostgreSQL `linkedin_channels_synthetic` reproduced three failures before implementation: generic create/update accepted fabricated verified OAuth state; unrelated settings erased existing connection metadata. Evidence: `channel-guards-red.txt`.

The shared settings guard rejects caller changes to server-owned OAuth evidence/ciphertext and verified author/account/token bindings, including nested `raw_account`. It preserves stored truth on ordinary, name-only and masked-token settings updates. The PUT transaction locks the current channel before reading and merging, so a concurrent OAuth completion cannot be overwritten using stale settings.

The transaction is scoped to LinkedIn only: other channel types retain their original direct configuration merge/update path. This avoids changing unrelated VK route/test semantics. LinkedIn reloads its scoped channel after acquiring the row lock; an initial settings read never supplies authority for the locked merge.

Five real HTTP/PostgreSQL tests pass: forged create, forged update/identity/token swap, normal update preservation/redaction, name-only/masked/nested preservation, and concurrent OAuth completion. Global provider-call spy stayed at zero. First three tests followed RED then GREEN; final two are additional regression coverage. Evidence: `channel-guards-green.txt`.

Container invocation: `docker compose -f tests/tdpd/linkedin-api-connection.compose.yaml run --rm -e DATABASE_URL=postgresql://synthetic:synthetic@synthetic-db:5432/linkedin_channels_synthetic checks node --test --test-concurrency=1 /source/tests/tdpd/linkedin-channel-guards-postgres.test.cjs`.

No dependency/build installation or host application execution. Final combined build and mandatory quality gate belong to root integration; owner UAT remains separate.
