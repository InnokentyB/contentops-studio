# Local engineering review

Owner approved the concrete local design before implementation. The final path is the existing MCP prepare command, scoped to approved + approval_required + supported direct Telegram. No new sender, schema, Owner release or scheduler admission is introduced. Drafted, ready and owner_released state preservation remains explicit and tested.

The oversized legacy tasks module receives only an import and a small dispatch branch. Transactional preparation and safe operator diagnostics/serialization live in small focused modules. Current actor/project membership, non-demo owner/editor authority, exact current package, active decision/durable asset, hold/reassessment/storage and all delivery/job/lease/release histories are checked under a bounded serializable transaction and row lock. Initial snapshot/CAS detects source drift. Audit failure rolls back state; lost commit response remains unconfirmed and requires readback. No audit or error contains raw channel/plan credentials; response redaction covers legacy stored metadata without rewriting reviews.

An initial quality-gate finding treated inline strings on decision.decision as business bindings. The code now uses the existing domain VisualDecisionCode enum; no scanner/baseline/permission exception was added. Findings remain6823, minimum score77 is preserved. This is a self-review, not an independent security review.

Docker verification:37 focused synthetic PostgreSQL/MCP cases plus158 nearby approval, tenant, Telegram payload/delivery/secrets, HTTP/MCP diagnosis and language regressions;195/195 PASS. Backend compile PASS. Required quality gate PASS. RED and intermediate build failures are retained rather than reported as green. No provider access, production repair, public push/PR/deploy or Owner UAT was performed.

After an authorized rollout the existing sole Publisher should fresh-read the task/fact/attempt state, call ba_prepare_publication_task, verify ready_for_execution with unchanged approval_required/current revision/asset/slot, then obtain the existing exact Owner release and execute the normal send workflow. An existing attempt/hold/release is an actionable refusal, never a reason to repeat review or reset history. Engineering verification does not prove a real publication.

Local validation used existing reviewed dependency images and source/results under /tmp. Tower root storage remains constrained; only four verified unreferenced dangling images were removed, without force. No containers, volumes, databases or verified backups were pruned. A future release still needs its normal storage reserve/backup/restore checks; those requirements were not weakened.

## PR 201 review corrections

Independent review found two P1 diagnostic defects, reproduced by five failing registered-MCP PostgreSQL cases. Approved Telegram dispatch now reaches its transaction before the legacy fail-fast visual gate. The same storage, visual/reassessment, exact-package and delivery guards remain enforced under lock; unsupported transport is refused before writes. Other states/transports retain their original path. Pure package guards return every independently established cause in stable order, with field-specific correction. Missing prerequisites do not invent dependent mismatches. Storage incidents retain their actual cause at the operator boundary. No gate, baseline or publication authority was removed.

All 200 container regression cases pass, including the five review reproductions; backend compilation passes. No schema changes or provider calls. Initial RED evidence is retained. Release still requires current CI, backup restore verification and deployment health checks.
