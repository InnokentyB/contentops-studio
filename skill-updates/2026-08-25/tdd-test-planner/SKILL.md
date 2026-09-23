---
name: tdd-test-planner
description: Analyze requirements for testability and produce a TDD-first test plan before implementation begins. Use when Codex needs to turn product requirements, specs, user stories, acceptance criteria, API contracts, or change requests into detailed pre-implementation test scenarios, edge cases, failure cases, and clarification questions so the feature can be built with Test-Driven Development and consistent interpretation.
---

# TDD Test Planner

Convert requirements into a test-first plan that can guide implementation from the outside in.

Treat ambiguous or untestable requirements as defects in the specification. Surface them early as open questions instead of inventing hidden behavior.

## Workflow

1. Reconstruct the feature behavior.
   Extract actors, inputs, outputs, state changes, dependencies, business rules, and acceptance criteria. State assumptions explicitly.

2. Check testability.
   Use `references/testability-checklist.md` to identify vague language, missing expectations, unobservable outcomes, hidden dependencies, and conflicting rules.

3. Derive tests before code.
   Use `references/test-scenario-catalog.md` to build the smallest useful set of tests that should exist before implementation starts: happy path, boundary cases, error handling, invalid input, state transitions, integration behavior, and non-obvious corner cases.

   For generative integrations, define a named deterministic adapter for acceptance tests. Use it to verify exact contracts, cardinality, persistence, idempotency, authorization, retries, and stale-version behavior. Define a separate provider-backed human UAT scenario for editorial or perceptual quality; do not ask one layer to prove the other.

4. Separate behavior from implementation.
   Write tests in terms of externally observable outcomes, contracts, and invariants. Do not anchor tests to internal implementation details unless the user explicitly asks for low-level unit coverage.

5. Extract open questions.
   Use `references/open-questions-framework.md` to list every ambiguity that could create inconsistent implementations, broken tests, or unreadable code.

6. Prioritize the suite.
   Mark which tests are essential to write first, which are important for robustness, and which can follow after the first red-green-refactor cycle.

## Review Rules

- Prefer behavior-focused tests over implementation-coupled tests.
- Treat missing acceptance criteria as a reason to ask questions, not to guess.
- Include both positive and negative scenarios.
- Cover edge conditions around empty values, limits, ordering, retries, concurrency, duplicates, and partial failure when relevant.
- Distinguish deterministic business rules from policy decisions that need product clarification.
- Keep scenarios precise enough that another engineer could implement tests directly from the output.
- Collapse duplicates, but do not merge distinct risks into one vague test.
- Never make deterministic acceptance depend on variable live-model output. Never claim that a fake adapter validates real-provider availability or qualitative usefulness.

## Expected Output

Structure the answer in this order unless the user asks for a different format.

### 1. Feature model
Summarize what the feature does, who uses it, which rules apply, and which assumptions were necessary.

### 2. Testability assessment
List unclear, conflicting, or unobservable requirements that weaken TDD readiness.

### 3. Test scenarios
For each scenario, include:
- priority: must-have, should-have, or nice-to-have
- level: unit, service, integration, API, UI, or end-to-end
- title
- preconditions
- action
- expected result
- notes on edge case or failure mode

### 4. Corner cases and failure paths
Highlight the scenarios most likely to break the feature or create regressions.

### 5. Open questions
List the clarification questions that should be answered before implementation or before finalizing the tests.

## Decision Heuristics

Use these heuristics when requirements are incomplete:

- If a rule cannot be observed in output, identify what observable signal or contract is missing.
- If multiple actors interact with the feature, create tests per actor and per permission boundary.
- If the feature changes state, include tests for the initial state, valid transitions, invalid transitions, and repeated actions.
- If the feature depends on time, ordering, or retries, include tests for race conditions, expiration, duplicates, and out-of-order events.
- If the feature accepts user input, include tests for invalid format, missing fields, boundary values, normalization, and malicious or unexpected input.
- If external systems are involved, separate contract expectations from integration-failure behavior.
- If the requirement contains words like "fast", "intuitive", or "properly", convert them into measurable expectations or raise questions.
- If one scenario bundles several rules, split it into multiple tests so failures remain readable.

## Working Style

When the user provides raw requirements, first normalize them into explicit behaviors and rules.

When the user provides an existing spec, preserve its terminology unless it is ambiguous.

When the user wants a TDD plan for a codebase change, inspect the current contracts and behavior so the proposed tests align with reality and highlight where requirements contradict the existing system.

Before delivery, re-read the Review Rules against the finished matrix and confirm that deterministic guarantees, provider availability, and human quality judgments have not been collapsed into one test layer.

## Resources

Read the following files as needed:
- `references/testability-checklist.md`: identify whether the requirements are specific and observable enough for TDD
- `references/test-scenario-catalog.md`: scenario types and coverage prompts for building the test list
- `references/open-questions-framework.md`: categories of clarifying questions that prevent inconsistent implementation
