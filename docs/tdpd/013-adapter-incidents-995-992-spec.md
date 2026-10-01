# Adapter incidents #995 and #992

## Operator boundary

This repair may persist attempts, audit records, read-only reconciliation results and verified publication facts. It must not retry an external send while a prior result is unknown. A publication fact requires a canonical provider identity and public permalink.

## LINKEDIN-995-ADAPTER-UNCONFIRMED

- Bind project 7, task 995, channel 5, accepted revision 1 and the accepted-body SHA-256 into one stable idempotency key.
- Register the already-observed UI call as a durable `verification_required` attempt before any further provider action.
- Repeated UI or MCP calls replay that attempt and never invoke LinkedIn publication.
- Reconciliation is read-only. Zero matches, multiple matches, or missing read permission remain `UNKNOWN` and keep resend blocked.
- Exactly one published provider object with the accepted body and canonical LinkedIn permalink may create the publication fact and complete the attempt.

## DZEN-992-ADAPTER-BINDING

- Bind project 10, task 992, channel 116, accepted revision 3, body SHA-256, decision 186, approved asset 97 and its durable checksum.
- The task-native payload is an `article` with title and the HTTPS visual; it is never downgraded to a feed post or redirected to the legacy draft-finalization path.
- Owner release and a fresh task-scoped connector proof are required. Missing credentials, stale proof, changed revision/body/asset/decision or an existing fact blocks execution.
- Provider uncertainty freezes the claim and forbids retry. A successful result requires a canonical Dzen public URL before fact creation.
- A frozen `provider_result_uncertain` claim may run only an owner-authenticated, read-only Studio list probe. The probe records exact-title reconciliation evidence without changing task state or invoking publication.
- An exact title match, an unreadable title field, or an incomplete Studio payload keeps retry forbidden. Only a complete zero-match readback plus a separate owner recovery command may mark the prior attempt `confirmed_absent` and authorize one new idempotency key.

## Acceptance tests

- LinkedIn historical call materializes once, replays by the same attempt ID, and never sends.
- LinkedIn readback creates a fact only for one exact provider match.
- Dzen dry-run exposes revision 3, article type, decision 186 and asset 97.
- Stale Dzen visual input is rejected before a provider call.
- Frozen Dzen readback permits no send; exact match and incomplete readback remain blocked, while a complete zero match can pass the owner recovery gate.
