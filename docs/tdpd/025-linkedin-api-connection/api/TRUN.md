# TRUN-025 API — local deterministic verification, 2026-10-19

Owner approved design025 before scenarios/code. Source /tmp/contentops-linkedin-api-connection based006025b. All workloads Docker on Tower; no provider, production, credentials, public writes or owner UAT. Working tree still changing concurrently; final exact-source combined build/gate owned by root.

## Scenario evidence

- Adapter initial RED: missing linkedin_api_adapter module. After implementation5/5 focused tests PASS: REST Posts shape and causal x-restli-id, safe image initialization failure, disallowed upload origin zero fetch, missing response identity UNKNOWN with exactly one POST, wrong image owner rejection.
- Lifecycle initial RED: missing linkedin_api_publication.service module. Defaultoff and malformed input boundary tests then2/2 PASS with network none.
- Legacy closure first run INFRA FAILURE: import expected synthetic TELEGRAM_BOT_TOKEN. Repeated with synthetic fixture produced intended3/3 RED: old sender reached fake fetch; dispatcher and direct fallback attempted database operations rather than rejecting. After closure3/3 PASS. Added diagnostic test RED PUBLISHER_EVENT_UNCLASSIFIED; after static LinkedIn-specific classifier4/4 PASS. Combined source suite11/11 PASS (adapter5 + lifecycle2 + closure4).
- Actual PostgreSQL first run7/9 PASS,2 RED: public publish passed extra fields into strict reconcile schema, preventing canonical completion. Fixed exact scope projection.9/9 PASS.
- Expanded PostgreSQL15/15 PASS: final-audit injected failure atomically rolls back fact/attempt/state; post-GET owner revocation, late abort, durable deadline/budget across service recreation; competing unknown transport API row blocks even an admitted first-row callback; concurrent owner revocation receives55P03 while finalizer holds authority, then succeeds after commit.
- Expanded18-case run17 PASS/1 INFRA FAILURE: legacy Prisma Post model includes six columns absent from historical39-migration synthetic baseline. Added those six columns only in asserted synthetic test fixture setup, never production migration. Final18/18 PASS at18:27:56Z, session59707. Source tests include actual legacy scheduled, immediate and stuck-reset functions preserving held LinkedIn rows; malformed quality/competing work release denial; wrong-body readback hold.
- Source test imports use current source mounted readonly and image dependencies; final combined compiled-image SDK/backend/frontend validation remains root responsibility.

## PostgreSQL scenario results

1. Exact accepted ordinary package release/send/GET: one canonical fact + delivered attempt + confirmed API state PASS.
2. Existing unresolved browser attempt: release blocked, zero API row/provider request PASS.
3. Ambiguous public POST: durable dispatch_started, one POST, no retry/new attempt GET without identity denied PASS.
4. Image upload failure: image identity retained, zero Posts calls/no text downgrade PASS.
5. Accepted byte resolution failure: zero initialize/public Posts PASS.
6. Owner revoked during image initialize: causal imageURN retained, next upload/send denied PASS.
7. Fact persistence failure: original post receipt retained; arbitrary generic fact callback cannot bypass hold PASS.
8. Foreign reconcile caller: no provider GET or budget mutation PASS.
9. Concurrent publish: exactly one attempt/POST/canonical fact PASS.
10. Owner revoked during GET: no late fact; causal receipt retained PASS.
11. Final audit exception: fact/delivered attempt/confirmed state all rollback PASS.
12. Abort during GET: no late fact; receipt retained PASS.
13. Recreated service exhausted3/20 budget: same deadline, no extra GET PASS.
14. Additional unknown transport recovery row: common finalizer rejects even admitted first row PASS.
15. Owner authority locks serialize revocation with canonical commit PASS.
16. Wrong body: receipt-bound hold, no canonical fact PASS.
17. Malformed quality JSON and competing work: release denied before requests PASS.
18. Legacy scheduled/immediate/reset actual entries preserve LinkedIn rows and make no provider call PASS.

Runner: dedicated tests/tdpd/linkedin-api-connection.compose.yaml checks service with DATABASE_URL=postgresql://synthetic:synthetic@synthetic-db:5432/linkedin_api_synthetic; node --test /source/tests/tdpd/linkedin-api-publication-postgres.test.cjs. Each fixture uses fresh random tenant/user/task and removes its own rows. No business IDs enter production authority.

## Quality/build evidence and limits

Root build03 generated current Prisma and compiled backend/frontend PASS. Changes after that build require root exact-source final rebuild. First quality gate failed runtime report because command omitted NODE_PATH; repeated with Docker dependency resolution identified score76 due undocumented LINKEDIN_API_DELIVERY_ENABLED and5 scanner findings. Added flag false in .env.example; replaced provider/visual protocol literals in business-position AST with named provider enum and existing shared VisualDecisionCode, without exemptions/baseline edits. Remaining frontend finding owned by OAuth integration. Final gate pending root.

Implementation limitations: no actual grants verified, default flag false; OAuth-issued read capability remains false until supported live read-only smoke. API readiness cannot promise availability from deterministic fixtures. Image preparation performs one bounded availability GET; PROCESSING remains held with causal media state, no automatic preparation replay. No historical browser attempt conversion/adoption/reset, no resend or browser fallback. UNKNOWN without trusted post ID cannot be automatically confirmed by history similarity. Full approval is engineering verification only; owner acceptance and any public export/deploy remain separate.

## Final source additions and fresh checks

- Protocol RED:2 additional adapter cases failed for absent LittleText escaping and acceptance of unapproved rich mention. Added literal encoder/strict inverse using official reserved-character grammar; accepted body SHA remains plaintext. Both GREEN. Another RED for documented text-only GET `content:{}` corrected to permit empty content while rejecting unsupported content fields. Final adapter8 + legacy4 + service2 =14/14 focused PASS on current source.
- Actual OAuth integration added to API database after root explicitly authorized the exact new OAuth SQL there. Real HTTP connect/callback, opaque state/cookie/CAS ledger, encrypted persisted channel, actual default AEAD resolver (no injected credentials), supported mocked post-read probe, API readiness and owner release all PASS. Forged outer metadata cannot acquire image capability. Full API PostgreSQL19/19 PASS at18:34:24Z session34345; includes official text-only `content:{}` response.
- Existing LinkedIn content contract regression changed expected legacy dispatcher error to the earlier stronger governed-route denial; zero-provider-call assertion and native formatter/semantic coverage retained.6/6 PASS.
- Exact shared-source quality gate PASS at18:31:14Z: score77, runtime7093 findings /7093 baseline, no transitions/exemptions. Later protocol corrections require combined final gate/build repetition by root.
- Personal actual `w_member_social` without documented image-read grants remains ineligible for image flow; organization/other documented actual scopes can establish image-read permission eligibility. This is not an image-object GET smoke. The particular uploaded image still must pass correct-owner AVAILABLE GET before public dispatch.
- Source-import legacy tests emit safe PUBLISHER_LOG_WRITE_FAILED because /source/logs is readonly while the runner only mounts /opt/planner/logs tmpfs. Console diagnostics and assertions pass; this is fixture log-path isolation, not a production readiness claim. Root notified to add source log tmpfs if desired.

Final API production-source freeze communicated to root. Readiness now reports `image_read_permission:boolean` and `image_read_probe:'not_performed'`; no claim of an actual image-object GET during consent/readiness. Static actionable causes distinguish exhausted read budget, another active read lease and the next read interval. Final API PostgreSQL20/20 PASS at18:37:08Z session24587;20th case verifies interval vs active-lease codes/remedies with zero extra GET/budget spend. Independent Threads reviewer reported no remaining concrete API source findings after authority locks, all-row/version holds, caller binding and causal image receipt fixes. Exact-source final combined build/gate remains root-owned.
