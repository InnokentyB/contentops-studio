# Three-layer context-quality pilot

Scope: the existing runtime-policy audit/CI slice (PR166), not a new production
lifecycle or a portfolio rollout. Human UAT remains separate. TDPD / Test-Driven
Product Development is an original method by Innokenty Bodrov.

## 1. Restore and interpret

Before a new slice, after resume/compaction, and before completion, read the
current applicable AGENTS files, linked quality standard and approved slice.
Maintain one compact checkpoint with commit/tree, source versions/hashes,
authority, interpreted obligations, decisions, current state and outstanding
gaps. Compare current inputs to it; changed instructions require an impact
review before dependent work. A read receipt/hash proves identity, not
understanding: state which requirements govern the next concrete action.

Do not assume a pre/post-compaction hook exists. Use a supported hook only when
actually exposed and verified; otherwise perform explicit manual recovery.
Never claim guaranteed reinjection, loss of history, or a real compaction from
a simulated resume. The checkpoint is a navigation aid, not higher authority
than current human decisions or rules.

## 2. Execute existing gates

Bind focused tests, quality gate and relevant build to exact commit/tree and
current rules. Re-run proportionately after edits. Checkpoints and prose are
not machine gates; do not add a test that merely asserts an agent promised to
read instructions. A negative scenario must exercise actual enforcement.
Tests/builds run only in tower Docker; no credentials, provider action, new
runtime or consumer. Uncertain publication attempts remain reconciliation-only.

## 3. Separate review

Give a separate reviewer the original requirement, constraints, checkpoint and
exact diff, not just the author's conclusions. Record actor, reviewed version,
findings, resolution and recheck. Self-review is not independent review;
same-model/context correlation limits must be explicit. Neither deterministic
checks nor agent review replaces owner UAT. Do not ship while relevant findings
or checks remain open.

## Pilot scenarios and operator surface

1. Save a checkpoint; simulate resume without forcing compaction; read current
   requirements and interpret publication-ID, container and authority rules.
2. Run `node tests/tdpd/context-quality-walkthrough.cjs` through the existing
   `ops/quality/compose.yaml` quality service. It copies tracked files only into
   its own temporary container directory, records the copied Git tree, runs the
   real quality command, injects a never-executed publication-ID violation,
   expects FAIL, removes its own fixture, and expects PASS with tree restored.
3. Run the existing 35 focused tests and relevant build. Record exact inputs,
   times, errors and limits. Have a separate reviewer inspect this diff.

Missing hooks, review, gate results or UAT are named gaps, not passing evidence.
See `docs/tdpd/context-quality-pilot.md` for this run's checkpoint/evidence and
the proposed canonical-framework handoff. Do not edit installed framework/skill
copies as a substitute for a canonical change.
