# Green Phase Rules

Implement just enough to satisfy the failing tests.

## Core Rules

- Start with the narrowest possible production change.
- Prefer explicit logic over premature abstraction.
- Reuse existing project patterns where they already fit.
- Keep new branches, state changes, and side effects easy to explain.
- Avoid coupling the implementation too tightly to incidental test details.

## Practical Guidance

- Fix one behavior cluster at a time.
- Run the nearest relevant tests after each meaningful change.
- If a new helper reduces duplication immediately, add it only after the behavior is understood.
- If a failing test reveals a missing validation or guardrail, implement that rule at the correct boundary.
- If implementation requires changing a public contract, verify that the tests and requirements explicitly support the change.

## Anti-Patterns

- Large rewrites to satisfy a small set of tests
- Adding dead code for hypothetical future scenarios
- Mock-driven implementation that ignores real contracts
- Refactoring while tests are still red for unknown reasons
