---
name: tdd-test-implementation
description: Prepare or repair project test infrastructure and create feature tests in a TDD-first workflow. Use when Codex needs to inspect an existing codebase, determine whether the project can run automated tests, add the minimum necessary test setup if it is missing, and then write failing tests for a new feature or change before implementation begins.
---

# TDD Test Implementation

Set up the smallest reliable test foundation the project needs, then write the tests that should fail before production code changes are made.

Prefer minimal, idiomatic project-native tooling over introducing a new framework unless the existing project has no practical test path.

## Workflow

1. Inspect the project test surface.
   Detect the language, framework, package manager, existing test runner, coverage tools, test directories, CI hooks, and current conventions. Use `references/test-infrastructure-checklist.md`.

2. Decide whether infrastructure work is needed.
   If a working test stack already exists, reuse it. If it is missing or broken, add the minimum setup needed for feature tests, fixtures, mocks, environment bootstrapping, and repeatable local execution.

   For external providers, prefer an import-safe dependency seam: the test must be able to install a mock provider without importing or initializing unrelated storage, credentials, network clients, or global application boot logic. Extract the narrow payload-and-provider boundary when import-time side effects prevent isolated tests.

3. Preserve project conventions.
   Match existing naming, folder layout, assertion style, test doubles, factories, and helper patterns whenever they already exist.

4. Implement the red phase.
   Use the requirements or the output of `$tdd-test-planner` to create failing tests first. Use `references/tdd-test-writing-rules.md` and `references/test-coverage-matrix.md`.

5. Keep the scope honest.
   Do not implement the feature unless the user explicitly asks for it. The default job is to prepare infrastructure and write tests that express the intended behavior before implementation.

6. Verify the test path.
   Run the relevant test command when feasible. Confirm whether the tests fail for the expected reason, or whether infrastructure issues still block the red-green-refactor loop.

## Review Rules

- Prefer extending existing test infrastructure over replacing it.
- Keep setup minimal and local to the feature unless a shared helper is clearly justified.
- Avoid speculative framework migrations.
- Write tests against observable behavior and contracts, not private implementation details.
- Keep each test focused on one rule or failure mode when possible.
- If the project lacks a safe deterministic way to test a behavior, add seams or helpers that make the behavior testable without hiding the real contract.
- Provider-boundary tests must assert the exact normalized payload received by the mock and the provider identity returned on success. They must fail before any external call when required input is missing, and they must not accept a response without the configured success identity.
- Do not satisfy a provider test by supplying placeholder credentials to unrelated services unless those services are part of the contract under test; prefer removing the import-time coupling.
- Call out blockers clearly when missing requirements or architecture issues prevent meaningful tests.

## Infrastructure Decision Rules

Use these heuristics when evaluating the codebase:

- If the repo already has a test runner and passing test command, integrate with it.
- If tests exist but are inconsistent, follow the dominant local pattern in the nearest relevant module.
- If no tests exist, choose the lightest mainstream toolchain that fits the project stack and can run in CI.
- If environment setup is heavy, prefer a narrow harness for the feature over global boot logic.
- If external dependencies make tests flaky, introduce stable mocks, fakes, fixtures, or contract boundaries.
- If importing the unit under test initializes unrelated infrastructure, introduce dependency injection or a narrow import-safe adapter before adding broader environment bootstrapping.
- If the feature spans layers, start with the highest-leverage layer that validates behavior cleanly.
- If the red phase fails because setup is broken rather than behavior being absent, fix the setup first.

## Expected Output

Structure the answer in this order unless the user asks for a different format.

### 1. Test infrastructure assessment
Summarize what test tooling already exists, what is missing, and what setup work was added.

### 2. Changes made
List new or updated config, helpers, fixtures, scripts, and test files.

### 3. Implemented tests
Explain which scenarios were added and how they map to the requirements.

### 4. Verification result
State which command was run, whether the tests executed, whether provider calls were mocked, and whether they failed or passed for the expected reason. Confirm that unrelated credentials and services were not required by the test harness.

### 5. Remaining blockers or next step in TDD
Identify what needs to happen next: refine tests, implement production code, or answer open questions.

## Working With Existing Skills

When available, use prior artifacts instead of re-deriving them:
- If the user already has a scenario list from `$tdd-test-planner`, implement that plan faithfully.
- If the user already has security or resilience constraints from `$resilient-solution-review`, ensure the tests cover those behaviors where appropriate.

## Resources

Read the following files as needed:
- `references/test-infrastructure-checklist.md`: evaluate whether the repo is ready for automated tests and what minimum setup is needed
- `references/tdd-test-writing-rules.md`: write failing tests that are readable, behavior-focused, and aligned with red-green-refactor
- `references/test-coverage-matrix.md`: decide which layers and scenario types should be covered for the feature
