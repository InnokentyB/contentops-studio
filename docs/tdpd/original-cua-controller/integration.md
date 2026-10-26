# Original executor controller integration — LOCK028 implementation handoff

Owner current instruction: implement stop/transfer of the SAME original attempt with the existing sole Publisher, no replacement attempt/browser/send transport, no risk acceptance. This is the concrete decomposition of already approved LOCK028, not a claim of Mac native readiness. Branch codex/original-cua-controller starts from current main37af554; PR204 stays separate. No production activation in this packet.

## Components and ownership

Planner owns accepted package/Owner/tenant scope, recovery reservation/budget, immutable attempt key, generation, challenge issuance/consumption, atomic adoption, audit and private pickup. The original Mac controller owns only its actual authenticated native/CUA session, key custody, operation inventory, stop/drain/revoke and same-profile reads. Codex/CUA itself owns cancellation and dispatch of already submitted CUA jobs. Our wrapper cannot retrospectively control jobs that bypassed it.

Use existing original Mac Chrome/profile. Do not move the profile to Tower or use an alternative sender. Existing CUA reader may read identity/history after a valid stop. This control channel exposes no arbitrary browser commands, shell, URL fetch, JS injection or send endpoint. Sole Publisher remains the only actor able to request normal Submit under Planner gates.

## Control transport and cryptographic binding

Prefer an authenticated original-Mac outbound connection/poll to the existing Planner controller over HTTPS; no inbound/public Mac port, new browser, SSH key sharing or replay of Codex login tokens. A fixed deployment-owned endpoint and issuer registry are configuration, never caller URL/JWK input. Reuse supported existing cross-host control transport if Mac investigation establishes one; no automatic protocol fallback. Transport authentication alone does not establish browser custody.

Use separate request/receipt keys pinned server-side to the original runtime/profile custody registration; P-256 SHA256/IEEE-P1363 matches the reviewed native signing convention. Mac private key stays in original host protected key storage; no private keys, leases, cookies or raw content in envelopes/logs. Pairing must bind actual native instance/session/profile and reviewed native cancellation capability; possession of a new signing key is not proof of old-session ownership. No automatic TOFU or treating a Publisher-returned public key as trusted.

Every challenge/receipt binds version/domain/purpose, issuer key ID, original runtime instance+epoch, original CUA context/profile digest, project/task/attempt/work, immutable package/approval/original lease/attempt-key digests, exact generation, unique server challenge, issued/expires timestamps, reviewed native capability-contract digest and protected source evidence digest. Server validates signature, pinned native binding and byte-exact scope, freshness/deadline and current durable challenge before atomic one-shot consumption. Edits to any field invalidate the signature. Signed assertion is authenticated evidence, not OS/browser attestation: do not translate it into oldExecutorQuiescent without a registered verified native stop implementation.

## Durable generation and receipt replay

Reuse LOCK028's existing BrowserDeliveryRecovery reservation, BrowserPreparationExecution CAS/generation and outbox. Persist pending challenge+operation binding before asking Mac; consume verified receipt in the same serializable transaction that revalidates Owner/package/no permits/authority and advances recovery. Existing unique audit and row-version/generation constraints enforce single winner; process-local maps are not authority. Idempotent transport redelivery returns the same outcome, never a new challenge/budget/permit. Restart/disconnect preserves pending/consumed/revoked state. Unknown commit outcome -> read existing reservation, no resend.

Mac controller must persist revocation tombstones and highest admitted generation across restart. Every new controller-routed CUA operation checks that generation before enqueue and at actual dispatch. This fences only controller-owned operations. Historical direct CUA calls require a native revoke/drain primitive covering every child/queued/offline callback; adding a local generation number does not stop them.

## Exact native API request for Mac investigation

Find supported operation names/version, authenticated source and documented terminal semantics for: enumerate original thread/turn CUA operations INCLUDING descendants; revoke their execution capability; cancel/drain active/queued commands; await terminal ACK; reject stale handles/generation after restart; identify exact original browser context; same-context read-only profile/history. Record whether each operation exists, not guessed method strings. Need server-verifiable receipt of stop and coverage under fresh challenge (or a trusted adapter binds fresh challenge to an immutable authoritative native receipt and current drain verification).

Known app-server0.164.0 turn/interrupt is turn cancellation, not an exposed generation-bound CUA fence. remoteControl/client/revoke is client access revocation, not demonstrated child-CUA drain. If native API cannot stop or exclude an outstanding historical operation, return UNKNOWN/unsupported and keep the same attempt held. Do not close a whole personal browser or kill unrelated work as a shortcut.

## Existing callable adaptation and production composition

1. Integrate reviewed LOCK028 implementation once, from its original engineering branch, against current main; it is not currently in main. Preserve all historical writer/fact guards and existing v2 holds.
2. Application-owned LegacyBrowserSupervisor.fenceLegacy(context,signal) invokes only the authenticated original native stop/drain adapter, validates original custody and emits existing legacyCustodyProof after complete zero-permit/zero-dispatch accounting. PreparationSupervisor.quiesce repeats supported generation-specific stop under later challenges.
3. LegacyBrowserReader.read(context,control) uses only that same registered Mac profile and supports FOUND/ABSENT/AMBIGUOUS/UNAVAILABLE. Charge takeRequest before every page/request; abort/time budget enforced on Mac AND Planner. Bare feed-empty/screenshot cannot claim complete absence. FOUND goes through same-attempt canonical reconciliation; possible delayed dispatch stays UNKNOWN.
4. Production composition injects the same pinned supervisor+reader into createLegacyBrowserRecovery and createPreparationRecovery at server bootstrap. Keep adoption absent until real adapters are available. Flags do not supply ports. Public MCP never accepts keys, supervisors, evidence flags or callback URLs as authority.
5. Private pickup is authenticated by existing sole-Publisher principal plus registered runtime/profile identity, checks generation/package/attempt/work/lease and reservation atomically, consumes existing outbox once, and returns only that scope's rotated lease to that owning executor. Old identity/generation/queue callbacks reject. The lease never appears in status/audit/control receipts. Keep ordinary generic preSubmit from bypassing preparation holds; the registered executor invokes supervised preSubmit then its exclusive dispatch boundary. No new send implementation.
6. Adoption -> existing generation-bound pickup -> fresh exact editor/profile/media/duplicates observations -> normal one-shot first permit with ORIGINAL attempt key -> sole Publisher sends. Lease expiry/key correction alone never permits any of these transitions. An issued/lost permit or uncertain existing dispatch forbids resume.

## Deliverable boundaries and checks

Controller-side signature/binding/freshness verification can be implemented/tested now with generated test keys; it does not assert native cancellation. Durable state uses existing LOCK028 ledger/repository; do not add a second competing authority table or fake SQL adoption. Mac investigation supplies actual stop/drain and same-profile reader before real registration or no-send acceptance. Synthetic signing tests prove protocol checks only.

Required no-send integration checks: forged/wrong issuer/profile/epoch/context/package/generation/challenge, replay/race, partial coverage, outstanding child, stale queued request, expiry/restart/revocation, wrong principal, absent runtime and cancellation. Native conformance must prove old direct callbacks cannot dispatch; synthetic ACK is insufficient. Then production readiness/release under existing Owner scope. Actual sends remain sole Publisher only; no engineer submission or task-specific code.
