# SOURCE-side adapter: explicitly not connected

This file describes the boundary required of the ORIGINAL Mac runtime. It is not an implementation, an admission certificate or a claim that any corresponding SDK method exists. Current available Tower protocol/SDK and integration catalog provide no original Mac CUA stop/drain/fence interface. No replacement browser/cloud transport is allowed.

## Separate trust chains

1. Controller envelope authentication proves that a pinned signer supplied exact binding/challenge bytes. The implemented browser_executor_receipt helper stops at that fact. It does not attest an OS process, drain a native queue, register a runtime or consume a durable challenge. A new self-signed key and JSON oldExecutorQuiescent=true are not custody.
2. The SOURCE adapter must invoke the actual supported originalRuntime operation covering all historical CUA children/queues/offline callbacks, await the native terminal result and verify its authenticated origin and scope. Only native guarantees plus complete observed custody may support legacyCustodyProof. The actual native operation name/version, transport and verification API are currently unknown. turn/interrupt followed by interrupted state is not a substitute.
3. The same SOURCE adapter must enforce a durable revoked-generation tombstone before queueing AND dispatching every subsequent controller-owned CUA command. This alone cannot stop a historical direct call outside the controller. Original native drain/revocation must cover those calls separately.

## What the source implementation must supply

For the existing original Mac browser/profile, an app-owned adapter supplies the existing LegacyBrowserSupervisor.fenceLegacy and PreparationSupervisor.quiesce callbacks. Each must invoke an established native API; there is no default-success implementation in this review. It verifies source/native instance/epoch, original CUA session/context/profile and every original child/callback, fresh server challenge, deadline/cancellation and terminal ACK. A timeout, unknown child, unsupported method, stale native session or incomplete lifecycle returns unsupported/UNKNOWN, never a proof assembled from Planner absence/lease expiry.

The server must be able to verify the authoritative native receipt or trust a specifically reviewed authenticated native adapter with documented stop semantics. Merely wrapping arbitrary caller data in a signature cannot establish them. No published receipt schema promises that the proprietary CUA service signs receipts; the actual Mac investigation must establish how provenance is verified. Controller request and response key pins are necessary transport controls, not sufficient native custody evidence.

A same-profile reader implements existing LegacyBrowserReader.read(context,control). It invokes only supported read operations in that original context, validates actual account, immutable package/media identity and coverage/freshness, counts every request, honors abort/deadline and returns supported FOUND/ABSENT/ambiguous/unavailable. Old tab closed, empty feed or missing DB permit alone cannot prove absence of delayed effects. FOUND reconciles the existing attempt; no send.

## Production registration and private pickup — not wired here

Production still supplies no real supervisor/reader. This branch's registration accepts no source port, key or proof in MCP request data; unavailable runtime keeps mutating adoption hidden. LegacyRecoveryRequest is strict and rejects injected receipt/quiescence fields. An additional PostgreSQL test verifies that even a valid authenticated synthetic envelope cannot register a runtime, rotate the historical lease, create custody or issue a permit.

Once actual SOURCE implementation and conformance evidence exist, bootstrap pins its original identity and injects it through the existing app-owned service constructors. Durable challenge consumption, permission/package/attempt revalidation, recovery CAS/outbox, private runtime-principal pickup and the exclusive normal first-permit/dispatch path must be joined before activation. These transport/native wiring pieces are not implemented by the signature helper or by the default preview tool. No runtime is registered merely by deploying this branch or setting an environment flag.

## Current outcome

Implemented/tested: controller contract, scoped historical recovery state/transactions, actual MCP denial boundary, immutable-attempt and generation checks, synthetic PostgreSQL concurrency/rollback, envelope signature/binding/freshness verification. Not connected: actual Mac control transport, native stop/revoke/drain/ACK verification, persistent source generation tombstones, native profile reader, receipt-to-durable-challenge wiring and authenticated live private pickup.

Next integration step belongs to the SOURCE capability investigation: identify the actual original-runtime callable and cancellation coverage, obtain an authenticated no-send terminal receipt and stale-call rejection result, then implement/review those callbacks. Current files contain no fictional native call or self-signed stop fallback. No new Owner GO/risk acceptance/manual forwarding is requested.1150/1158 and54/51 remain unconfirmed; this packet makes no publication claim.

## Updated controller status

DURABLE-COMPOSITION.md and browser_executor_challenge_store.ts supersede the earlier statement that durable consumption/composition were unimplemented. The controller now persists/validates/consumes challenges in the existing adoption/quiescence/fact transactions and bootstrap explicitly supplies absent Source ports. The actual native SOURCE implementation, native tombstones, authenticated Mac transport and live private pickup remain NOT connected. Synthetic native ports exist only in tests.
