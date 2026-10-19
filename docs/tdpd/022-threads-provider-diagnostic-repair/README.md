# Threads provider read diagnostics repair

Approved existing022 actionable-error contract; owner requested the first four development directions in parallel on2026-10-19. Local repair only. Source base main d36bce9b41b37732dd3c1dbcbc7e8bb3c1d9e4f6. No production/configuration/provider requests, publication, credentials, attempt changes or historical recovery adoption.

## Problem and resulting operator behavior

The existing Threads transport retained a safe typed provider code, operation and HTTP status. The MCP mapper inspected only bracketed Error.message codes, so typed history-read failures collapsed into THREADS_REQUEST_FAILED and their safe metadata disappeared from structured logs as well.

The existing identity/history read boundary now maps only allowlisted ThreadsProviderError metadata. HTTP401 requests secure reconnection;403 requests permission verification;429 explains the rate limit;5xx/network explains service availability; JSON decoding explains response-contract failure; timeout/cancellation explains the bounded interrupted read. Unknown codes/operations/status values remain masked. Every response retains retry_allowed:false and instructs inspection of existing attempts/facts before any later publication request. Uncertain delivery always requires same-attempt reconciliation.

Optional provider metadata contains only operation read_own_posts/test_connection, corresponding provider_history/provider_identity stage, and bounded integer HTTP status. Stage describes the read operation; it does not claim a historical failed request reached a particular transaction boundary. No URL, cursor, account, body, token, raw response, error message or stack is serialized. HTTP/UI existing consumers remain compatible; the changed generic path is MCP, and the HTTP regressions verify compatibility rather than claiming a new HTTP route.

Cancellation normalization is limited to identity/history reads; sender/recovery control ordering and all publication guards remain unchanged. No background retry/recovery loop is introduced. Dry-run still checks local package/release readiness and does not verify the provider.

## Causal evidence

`red.txt`: actual registered ba_publish_threads_task via SDK client/server and real GenericThreadsReleaseService/ThreadsService history transport, synthetic fetch only. Seven provider cases failed with generic THREADS_REQUEST_FAILED; two compatibility/masking cases passed. This was behavior RED, not environment failure.

Final tests expand this to12 new cases:401/403/429/503, invalidJSON, network, timeout, cancellation, three malicious metadata fields, local-only dry-run. Every preclaim failure asserts GET only, zero provider POST, zero attempts/recovery rows and unchanged task readiness. Each checks MCP text/structured parity and one safe structured log. The synthetic service release is created before injecting the history failure.

`green.txt`:48/48 source cases (12 new plus36 existing API boundary/recovery/phase cases), then38/38 compiled affected Threads/MCP/HTTP/diagnostic regressions; zero skipped. New suite is explicitly included in the existing publication-reliability workflow.

`build.txt`: backend/Prisma and frontend PASS, image planner-threads-diagnostic-repair:20261019 sha256:479408db3cf6c7f3dafe0b764a17167b5db60a23b60313e1eb158c7cd1011165. Tests execute Docker-only, Linuxamd64, non-root, networknone, resource/PID limits; injected synthetic database is unavailable and no database was queried.

`quality.txt`: score77/minimum77, runtime7093/baseline7093, no transitions/exemptions/hardstops. OwnerUAT remains pending. Publicpush/PR/deploy require separate concrete approval; old live failures cannot be retrospectively attributed to a status or stage from this source repair.
