# Executable controller composition — 2026-10-25

This supersedes the earlier helper-only staging status. Actual production Source ports are still absent. It does not claim physical Mac cancellation or publication completion.

## Implemented path

`createOriginalExecutorController({deps, source?, clock?})` now composes the existing historical adoption and preparation services. Real application bootstrap calls this factory with NO Source, so mutating adoption remains hidden/unavailable. Source ports cannot be supplied in MCP data or enabled by a flag. Source configuration must supply the pinned original registration, supports, stop + independent native verifyStop, read + independent native verifyRead; incomplete/malformed registration stays unavailable before native calls. Wrapper authentication never replaces native verification.

When a reviewed Source exists, the callable flow is:

1. Read/revalidate current non-demo Owner, immutable package/approval, exact original attempt/key/work lease digest, generation and existing recovery reservation. Issue a bounded challenge under the existing nonce/generation/purpose into WorkflowEvent. Existing unique(project,actor,command,key) enforces one issuance; retry reuses its original expiry/pin and never extends it.
2. Invoke the configured actual Source stop/read port with scoped expectation and cancellation. Independently validate authoritative native evidence using the Source verifier; only then verify the pinned wrapper signature and canonical proof digest. Persist verified receipt/evidence hashes, never raw native payload, signature, key, token or lease.
3. Consume fence/read challenges inside the SAME serializable transaction as historical custody/adoption ledger CAS and audit. FOUND consumes them inside canonical same-attempt fact finalization. A receipt cannot be consumed twice or under another scope/generation. Receipt verification can survive a crash, but it alone grants no new authority.
4. Reuse the existing preparation ledger/outbox/generation resume. Initial adoption already has proved quiescence and does not call stop twice. Later preparation recovery uses a new quiesce challenge; consumption happens inside the same quiescent-state/audit transaction before the existing generation-CAS/outbox path. Failed audit rolls consumption and state transition back together.
5. Existing private preparation pickup, preSubmit, dispatch and confirmation callables remain unchanged and bound to current Owner/package/generation. No new public pickup endpoint or provider sender is created. Authenticated Mac transport to these private callables is NOT connected yet.

Protected writes use existing tables/constraints, no migration. Current-row, Owner/package, generation/nonce/lease, no-permit and deadline checks repeat at issuance, verification and consumption. Admission-off retains all old holds. Events are bounded/scoped and append-only; consumed markers contain hashes and submission_permitted=false. Generic work-queue commands use fixed command names, not caller-selected proof event names.

## Verified execution

TDD RED6cases before the factory existed. Integration exposed property-order instability in an ordinary JSON proof digest; replaced with bounded canonical JSON digest and added order/cycle/size negative tests. Initial adoption consumes two receipts (fence/read); subsequent new preparation recovery consumes its own quiesce receipt. Tests use real PostgreSQL and real generated signing keys with explicitly synthetic native oracle ports, not Mac stop ACKs.

Executable cases cover absent/incomplete Source, complete same-attempt adoption/outbox/private pickup and restart replay, valid wrapper without native proof, concurrent adoption, expired receipt, stale generation, atomic adoption audit rollback, quiescence audit rollback, later recovery and FOUND canonical fact/replay. Existing prep/recovery/MCP regressions are retained. Caller receipt or boolean cannot register a Source.

## Remaining without Mac versus actual Source work

Server persistence/composition is implemented; remaining server verification is CI/review of this change and transport integration with an actual authenticated runtime principal once the Source protocol exists. There is still no actual Mac stop/drain/revoke implementation, native receipt verifier, persistent SOURCE-side generation tombstone, live same-profile reader or control/private-pickup transport. A pinned in-process Source registry is application configuration, not a claim that native enrollment or live key revocation has been integrated.

Those physical/native capabilities cannot be inferred from interrupted turns or synthetic oracles. The real adapter must implement the OriginalExecutorSource contract against supported originalRuntime calls and document complete queue/child/offline coverage; no self-signed boolean or generic wrapper counter may assert it. No new Owner risk acceptance or manual relay requested. Production1150/54 and1158/51 remain unchanged by these tests; only sole Publisher may eventually send after real admission.
