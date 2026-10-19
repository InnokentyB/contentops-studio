# VK/Dzen current-main integration — local only

Existing approved contracts: VK-SHARED-DELIVERY-022 and DZEN-ADAPTER-LIFECYCLE-001. Owner requested the first four backlog tracks in parallel. This integrates PR178 head5cb4cff then PR180 head3f7121b into released main d36bce9. No public push, PR update, merge/deploy, provider access, session/credential use or consumer activation is authorized by this local integration.

## Preserved boundaries

Current LinkedIn API, Threads API and browser recovery fact fences remain composed with owned receipt-to-fact linking. MCP request tracking/shutdown remains composed with trusted publication principal context; strict input validation remains composed with actionable diagnostics. Visual reassessment and durable owned publication writer guards both apply. VK queue reads filter provider/protocol before decoding and retain strict package identity checks.

## Security corrections required by independent integration review

Demo identities cannot authorize owned lifecycle operations. Current user and membership are locked FOR SHARE in that order before content locking, including canonical fact completion. Immutable receipt custody remains independent of revoked caller authority.

Cleanup must retain remaining browser process-group children after the parent exits, including children created during shutdown. Signals are bounded to the registered private group, current UID, PID/start identity and original group leader identity. Empty groups never reopen cleanup authority. Existing sandbox, PID/resource limits and cleanup deadline remain mandatory.

## Preserved RED and repair checkpoints

- Source boundary initial11/13; repairs preserve strict package hash/revision/asset checks and modern MCP isError=false semantics.
- Source boundary18/18 PASS, real MCP HTTP principal isolation, queue isolation and CAS, writer holds, internal afterWrite plus recovery beforeCommit ordering.
- Docker backend/frontend build02 PASS, image926acb376f01; later security/diagnostic/cleanup changes require a fresh exact-source build.
- PostgreSQL initial41/41 PASS; LinkedIn API regression20/20 PASS.
- Known static error cause/action RED then11/11 GREEN; held-result projection causal RED then7/7 GREEN; raw provider text is excluded.
- Security RED demonstrates missing demo denial and successful concurrent authority update during fact completion; repaired full PostgreSQL43/43 PASS includes actual MCP demo denial/zero writes and both user/membership revocation lock timeout.
- Native first complete run27/28: OAR03 observed a live Chromium after cleanup; isolated reruns1/1 and2/2 passed, so no green claim from reruns alone.
- Deterministic cleanup RED reproduces live resistant descendant after browser-parent exit. Repair focused3/3 PASS covers existing descendant, late descendant, foreign-group zero signal and PID identity mismatch.
- Quality gate77/6823 baseline6823 PASS before final security/cleanup additions; final rerun required.

Raw logs are retained in `evidence/`, including failures and subsequent repairs. Engineering acceptance and permitted live provider UAT remain separate. Issues142/143 remain open; no synthetic result resolves an action restriction or establishes actual native inventory completeness.


## Final engineering verification

Status: ENGINEERING COMPLETE — OWNER UAT AND LIVE PERMISSION GATES PENDING.

Compiled production source: commit `1fb173d` (includes small ready package80b1ad86); subsequent changes add only CI invocation and this evidence. Final Docker image `planner-vk-dzen-integration:20261019`, config ID `sha256:c76bfa6ae10530030d66c747d9a1a41c96b3f5bb143192bb7629f0e08b919da5`, Linux amd64. Backend, frontend and standalone VK consumer builds PASS. The cached dependency image is the existing reviewed `planner-memory-001:20261018`; no native host workload or network dependency installation was used.

| Scenario boundary | Passed | Failed/skipped |
|---|---:|---:|
| Compiled VK consumer, authority and generic browser/visual recovery |145|0|
| Owned principal, real HTTP/MCP, mixed queue, writer/fact/Art and process cleanup |35|0|
| Actual PostgreSQL owned lifecycle, concurrency, rollback, demo and revocation |43|0|
| Actual PostgreSQL LinkedIn API lifecycle and common fact holds |20|0|
| Actual PostgreSQL Threads API lifecycle and common fact holds |8|0|
| Actual sandboxed Chromium independent native process/receipt/proof |28|0|
| Total focused checks |279|0|

Quality gate: PASS, existing score77, runtime6823/6823, no new baseline findings, transitions or hard stops. The inherited VK/Dzen baseline removes270 obsolete rows from main7093; no new exemptions are added. Initial compiled bundle checks found a missing built artifact, then the expected readonly output directory; the final existing-quality-equivalent tmpfs for `dist/connector` supplies ephemeral build output and all145 compiled checks pass. No refusal or zero-send assertion was removed.

Independent readonly cleanup review closed the browser-parent-only completion defect, negative-PGID timer reuse defect and early spawn-error listener defect. Final review at1fb173d identified no remaining P0/P1/P2 in that reviewed scope. Exact negative PGID signals now validate retained direct-parent/private-group/start identity; replaced leaders fail closed and dead leaders grant no signal authority. Group children retain PID/start identity, current UID and original leader generation; late children are rescanned, empty groups never reopen. Zombie classification is not a claim of OS reaping. The new five cleanup tests are included in the existing CI owned-boundary step.

## Reproduction and cleanup

Use the existing reviewed `tests/tdpd/linkedin-api-connection.compose.yaml` plus `evidence/verification.override.yaml`, project `tower-vk-dzen-integration`. It uses internal10.231.91.0/28, no ports or provider secrets, synthetic-only PostgreSQL tmpfs, readonly source/root, UID1000, CPU/memory/PID/log limits and bounded ephemeral connector output. Start only its synthetic-db; `checks` uses `run --rm`. `prisma db push --config /workspace/tests/fixtures/owned-publication-prisma.config.ts` prepares the empty shared fixture database. LinkedIn and Threads fixture databases are distinct named synthetic databases, never restored data.

Native checks use the pinned reviewed `ops/owned-publication-tests/compose.yaml` and image config06f5297407da27a070a6d1a2deec79003a2977b8aa037a64e2132116f97dc227. Export the compiled final image's `dist` into a temporary directory and readonly-mount it at `/workspace/dist`; run the existing native-tests command. All network remains disabled and Chromium sandbox stays enabled.

Health and logs are exit status plus scenario TAP in the evidence files. Stop/remove only these projects with `docker compose ... down`; never use `-v`, pruning or production data. Final verification containers and their synthetic stack were removed. Existing production services and preserved source branches were not changed.

## Remaining owner/operator boundary

No public export/PR update, production merge/deploy, provider call, secret provisioning, OAuth, upload/send, publication reset or consumer activation was performed by this integration. Dzen142 native Published/Draft/pinned end-of-list evidence and VK143 genuinely permitted operator admission remain open. The production Dzen action restriction and reconciliation-only UNKNOWN history remain intact. These conditions require actual permitted evidence and explicit owner UAT; a synthetic pass cannot clear a denial.
