# Local implementation status — 2026-10-20

Status: **LOCAL ENGINEERING VERIFIED / PUBLIC TWO-STAGE STAGING PENDING / OWNER UAT OPEN**.

The Owner approved the feature design and local implementation in this engineering chat. That approval does not authorize public export, PR, deploy, production confirmation records, provider reads/sends or transport activation.

## Result

The shared Owner-only MCP commands preview and record an existing VK wall post or Dzen article as an explicitly manual canonical fact. The preview binds the real current workspace manifest, task/fact digests, external identity, Owner attestation and preserved history. The commit verifies the same state and writes the canonical fact and append-only provenance atomically.

The original offset-bearing Owner message time is retained, alongside its canonical millisecond timestamp. Published edition remains unknown (`external_object_only`, `published_revision: null`); the current draft is not accepted or claimed as the published edition. Retained revision verification is not implemented and supplied revision claims are rejected with a concrete remedy.

Existing attempts, jobs, leases, work, approvals, assets and uncertainty history remain unchanged. Shared fences reject late transport mutations and prevent another canonical writer from adopting the same manually confirmed object. Generic queue claim/complete/block/release/reschedule also reject retained transport leases before any cached response or write; ordinary metric work remains usable. VK `.ru` and `.com` wall URLs resolve to one identity. Existing task/fact readbacks disclose manual origin and detect invalid provenance. No migration or new tables.

## Verified

- Final backend, frontend and standalone consumer builds: PASS in Docker.
- Actual MCP plus isolated PostgreSQL acceptance: 54/54 PASS, including the final queue custody repair.
- Compiled transport preservation and manual diagnostic cases: 22/22 PASS.
- Compiled existing Dzen/VK scenarios plus remote authorization, manifest, channel repair and process checks: 241/241 PASS on the final build.
- Additional existing owned-lifecycle/store PostgreSQL and boundary scenarios: 87/87 PASS (source execution using container dependencies; separately identified in TRUN).

Final build05 image: `sha256:7e5a93778baaddb962af375d67a0fbd03d6b1c98cc311dd22bf81651a1eee7de`.
Production baseline: `5b5bb0324d8f6b7003c0ca1fa2ca2e681c451c4b`.
Full causal RED, intermediate failures, final results and commands are retained in [TRUN.md](TRUN.md).

## Quality control and remaining release boundary

The original mandatory `npm run quality:gate` failed closed on 102 new and 102 stale statement fingerprints across 16 modified legacy files. The Owner then separately approved the source-bound preservation design for local tests and implementation. Stage A is local commit `0e3ac05b4de6eec3ceb53eacae5b5278cd5c4bec`: the exact reviewed manifest, strict validator, CI tests and evidence; product sources, scanner and baseline remain unchanged in that stage.

Stage B was composed locally on Stage A and replaces exactly 102 baseline identities, preserving format, counts, ownership and remediation. Its complete mandatory gate passes: score77/minimum77, 6823 findings/baseline rows, exactly102 pairs/16 files/110 occurrences. The full CI policy matrix passes126/126; the additional actual frozen-source case passes. The application source is byte-identical to the previously checked build05, so its build and publication-preservation evidence remain applicable. See the local run record and retained reports.

This is **LOCAL_SIMULATION**. The original released base has no preservation authorization and still correctly returns FAIL/BASELINE_WIDENED with no applied transitions. Public delivery requires a separately authorized policy-only Stage A PR and merge, then a feature Stage B PR rebased and freshly checked against that merged public base. No scanner fingerprints, blanket exemptions or publication permissions were changed. Local approval does not authorize public export or those merges/deploys, and Owner UAT remains explicit.

The production manual facts for the pending business cases have **not** been written by this implementation work. Production remains unchanged.
