# Approved preparation acceptance plan

Owner approved LOCK/QAR/ARCH/RISK on 2026-10-19. The deterministic supervised executor is synthetic and is never registered as production capability.

| ID | Preconditions / owning-operator action | Observable outcome |
|---|---|---|
| PREP-01 | Original approved start admitted by supervised executor | Original attempt plus durable PREPARE ownership; no send permission |
| PREP-02 | Proven transient failure, old generation quiesced | Same attempt, generation CAS, rotated lease, durable pending pickup; original error retained |
| PREP-03 | Restart after commit, pickup redelivery | One current pickup; no new generation/attempt/key |
| PREP-04 | Missing supervisor, late/missing ACK or stale generation | Held actionable result; no dispatch authority |
| PREP-05 | Issued permit, dispatch uncertainty or live challenge | Reconciliation only; no preparation replay |
| PREP-06 | Concurrent recoverers and zombie old worker | At most one generation/pickup/first permit; stale calls reject |
| PREP-07 | Revoked approval, changed package or wrong owner/tenant | No recovery mutation or provider call |
| PREP-08 | Durable 3-resumption/180-second budget | Replay/restart cannot reset counters/deadline |
| PREP-09 | Safely supersedable preparation-only challenge | Old authority invalidated atomically; submit-authority challenge remains blocking |
| PREP-10 | Existing MCP uncertainty handler | Correct application operation invoked, actionable serialized status, no raw lease/proof/secrets |

Actual browser executor admission and live UAT remain disabled until a real supervisor proves dispatch fencing. Historical attempts are never enrolled by inference.
