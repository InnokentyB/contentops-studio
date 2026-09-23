# Pre-Implementation Checklist

Use this checklist before editing production code.

## Contract Understanding

- Which exact tests are currently failing?
- What behavior do those tests assert?
- Which requirements or user-visible rules do the tests represent?
- Are there ambiguities or contradictions between tests and requirements?

## Failure Validation

- Do the tests fail for the expected reason?
- Is any failure caused by setup, fixture, environment, or unrelated regressions?
- Can the failing scope be narrowed to a specific module or layer?

## Change Surface

- What is the smallest module or function that can satisfy the contract?
- Which existing abstractions should be reused rather than bypassed?
- Which side effects, invariants, or integration points must remain stable?

## Stop Condition

If the contract is unclear or the tests do not reflect the intended behavior, pause and surface that mismatch before implementing code.
