---
name: tdd-feature-implementation
description: Implement a feature through the green and refactor phases of Test-Driven Development. Use when Codex has an existing failing test plan or concrete failing tests and needs to make the smallest production-code changes required to satisfy them, verify the tests pass, and then perform safe cleanup without breaking behavior.
---

# TDD Feature Implementation

Implement only enough production code to make the intended tests pass, then improve the design without changing behavior.

Assume the tests define the contract. If the tests and requirements disagree, surface the mismatch before coding blindly.

## Workflow

1. Reconstruct the target behavior.
   Read the failing tests, requirement summary, and any prior output from `$tdd-test-planner` or `$tdd-test-implementation`. Use `references/pre-implementation-checklist.md`.

2. Confirm the red state.
   Run the most relevant tests when feasible to verify they fail for the expected behavior gap rather than unrelated setup issues.

3. Implement the smallest green change.
   Use `references/green-phase-rules.md` to prefer narrow, contract-driven edits over broad rewrites.

4. Re-run tests frequently.
   Validate the targeted tests first, then the nearest broader suite that provides confidence.

   Before broad database-backed verification, match runner concurrency to the isolation and capacity of shared dependencies. Set an explicit safe concurrency level when suites share one database or constrained service. If failures resemble transaction timeouts or resource starvation, rerun affected scenarios sequentially before classifying them as behavior regressions.

5. Refactor safely.
   Once tests pass, use `references/refactor-guidelines.md` to improve naming, duplication, structure, and seams without expanding scope or changing behavior.

6. Report the result.
   Summarize which tests now pass, what production code changed, and any remaining concerns or follow-up work.

## Review Rules

- Prefer the smallest behavior-preserving change that satisfies the failing tests.
- Do not add speculative functionality not required by tests or explicit requirements.
- Avoid rewriting modules that can be fixed incrementally.
- If tests appear wrong, ambiguous, or internally inconsistent, stop and surface the mismatch.
- Keep refactors separate in intent even if they happen in the same turn: first make it work, then make it cleaner.
- Preserve existing public contracts unless the tests or requirements explicitly demand a contract change.
- Add small internal seams only when they improve testability or clarity materially.
- Treat shared-dependency contention as a test-infrastructure hypothesis that must be distinguished from product failure; do not weaken assertions to make overloaded suites pass.

## Green-Phase Heuristics

Use these heuristics while implementing:

- If one failing test can be satisfied with a narrow branch or validation rule, start there.
- If multiple tests fail for the same missing concept, implement the smallest coherent abstraction that satisfies them together.
- If a bug spans layers, change the lowest layer that can fix the behavior cleanly.
- If the code lacks a seam for deterministic behavior, introduce one with minimal surface area.
- If a refactor seems necessary before the feature can be added safely, make the smallest preparatory change, keep tests running, then continue.
- If broad changes are tempting, ask whether the current tests truly require them.

## Expected Output

Structure the answer in this order unless the user asks for a different format.

### 1. Target behavior
Summarize the contract being implemented and which tests or scenarios drove the change.

### 2. Production changes
List the files and code paths changed, and explain why each change was needed.

### 3. Verification
State which tests or commands were run and whether they passed.

### 4. Refactor notes
Describe any cleanup performed after reaching green.

### 5. Remaining risks or next steps
Identify any unresolved ambiguity, deferred improvements, or additional coverage that may still be useful.

## Working With Existing Skills

When available, use prior artifacts instead of reinterpreting the task from scratch:
- If `$tdd-test-implementation` already created failing tests, treat them as the immediate contract.
- If `$tdd-test-planner` documented open questions, avoid baking assumptions into production code without noting them.
- If `$resilient-solution-review` identified security or resilience constraints, preserve them while implementing the feature.

Before delivery, re-read the Review Rules against the executed checks. Confirm that shared-dependency contention was either bounded in advance or ruled out before reporting broad-suite failures as product regressions.

## Resources

Read the following files as needed:
- `references/pre-implementation-checklist.md`: confirm the starting point before changing production code
- `references/green-phase-rules.md`: implement the minimum code needed to reach green
- `references/refactor-guidelines.md`: clean up the implementation safely after tests pass
