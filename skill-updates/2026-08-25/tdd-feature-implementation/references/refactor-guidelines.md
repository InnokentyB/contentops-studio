# Refactor Guidelines

Refactor only after the relevant tests are green.

## Safe Refactor Targets

- duplicate logic
- poor naming
- long functions with mixed responsibilities
- awkward control flow
- testability seams that should be made cleaner
- repeated setup that belongs in a shared helper

## Refactor Rules

- Keep behavior unchanged.
- Run tests after each refactor step or tightly related group of steps.
- Preserve logging, validation, and error semantics unless the contract explicitly changes.
- Prefer small mechanical improvements over sweeping redesigns.
- Stop refactoring when clarity is good enough for the current scope.

## Exit Criteria

A good result means:
- the targeted tests pass
- the implementation is easier to read than before
- no speculative architecture was introduced
- the next change to this area is simpler, not harder
