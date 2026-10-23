# Approved local implementation scenarios

Owner approved concrete LOCK/QAR/ARCH/RISK in engineering chat23October2026, request call_54063f1ac2234c32b30afddc354f0ee3. Local tests/implementation only. Base557365154e415816730bfe744591878c7231941b.

D1: Authenticated operator invokes either common or dedicated Threads MCP sender with arbitrary canonical task and a complete exact generic-release envelope. Both select the existing common service, preserve stable keys/signal and never invoke legacy task tables or another provider.
D2: Incomplete release envelope exposes every missing required field in stable order, with supported correction, no claim/provider call and no legacy fallback. Scope mismatch/absent principal/forged actor/unsupported operation fail safely and reveal no submitted secrets.
D3: Common non-Threads owned/Telegram dispatch remains intact; Threads-only fields do not silently become ignored preconditions for another transport. Existing underlying generic release mismatch/unknown/idempotency/no-provider contracts remain green.
B1: Read-only registered browser diagnosis of one error-free pending attempt with exact matching recorded start/current work and active original actor-bound lease distinguishes active preparation. It does not claim NOT_DISPATCHED or grant a permit, does not mutate any record and returns no raw lease/error/copy.
B2: Same input after expiry or without executor control reports exact restoration/fencing need for the same attempt, never another start/release/attempt or a false active state.
B3: Issued permit, dispatch, uncertainty/error, persisted recovery, malformed/missing/capped event coverage, multiple attempts or wrong actor all remain reconciliation-only. A diagnostic cannot turn incomplete history into absence proof.
B4: Confirmed fact remains read-only; revoked/non-owner/foreign scope remains denied. All snapshots/results/logs remain safe. Existing real serializable execution gates remain the authority after preview.

All scenarios execute with synthetic in-memory MCP/DB ports in Docker; no live credentials, provider or account calls. A PostgreSQL-focused extension is required if implementation changes transactional write semantics; this packet introduces no writes.
