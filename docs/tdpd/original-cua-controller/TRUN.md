# Controller integration stage — 2026-10-25 Europe/Lisbon

Owner directed own-controller implementation/architecture on existing LOCK028 while coordinator investigates Mac native routing/API. Main baseline37af554; separate branchcodex/original-cua-controller. No changes to other unfinished working copies or PR204. No native/provider command or production mutation.

RED4/4fail due absent controller envelope verifier in baseline; actual code missing, not environment failure. GREEN initial4/4 real P-256 signatures/generated ephemeral test keys. Final adds wrong-key/tampered-evidence/private-key/oversized-lifetime cases. Backend buildPASS. Mandatory qualitygatePASS77/nohardstops/no new debt6823. Tests include each exact scope/native binding/purpose/challenge/generation/timestamp, invalid schema/signature, expiry and result contains no custody/send authority. Keys generated only inside isolated Docker test; no real credentials.

Implemented: pure strict signature, pinned issuer/runtime/epoch/context/profile/native-contract and exact challenge/package/attempt verification; static redacted failure envelopes. NOT implemented: native CUA stop, durable consumption/replay repository wiring, real transport, live runtime registration or private pickup endpoint. Integration document specifies these using existing LOCK028 ledger/CAS/outbox and sole Publisher. Verification does NOT consume a challenge or prove stop; integration must do both separately. No fabricated ACK, force-resume, new attempt/browser/send transport.

Docker commands from projectroot:
- docker compose -f ops/original-cua-controller-20261025/compose.yaml build checks
- same compose run --rm checks
- same compose run --rm --workdir /source --entrypoint npm checks run quality:gate
Reviewed inherited dependency image, buildnetworknone, nonroot1000, readonly runtime, resource/PID/loglimits and capdrop. No persistent services/volumes, all jobs --rm. No stop/down required after completed jobs. Parent operator README describes source/rollback. Rollback of this unused helper is code-only; retain all historical attempts and recovery holds.

Owner/provider UAT and actual original-native conformance remain outstanding. p7Publisher readback of55/53 is informational and grants no adoption through this code;1150/1158 likewise unchanged. No engineering-complete/full-publication claim.

Final focused run5/5PASS. Backend image configfe2396ff0b8b2d93747711756e93b7c4958fbfadb03e6950a78e0f8a55a65612; no runtimecode changed after build/quality. No production composition imports this helper (source-wide caller check). Published review branch is an integration stage, not admission or a historical-recovery implementation-complete claim.
