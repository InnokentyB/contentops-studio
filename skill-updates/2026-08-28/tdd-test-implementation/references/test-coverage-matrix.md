# Test Coverage Matrix

Use this matrix to choose where and how to test the feature.

## Layer Selection

- Unit tests: isolated domain rules, pure transformations, calculations, validation logic
- Service tests: orchestration, state transitions, coordination between collaborators
- API tests: request validation, response contracts, authz/authn behavior, error mapping
- UI tests: user-visible flows, rendering states, interaction rules
- Integration tests: persistence, messaging, real framework wiring, critical dependency contracts
- End-to-end tests: only the most important cross-system flows

## Scenario Selection

For each relevant layer, consider:
- happy path
- invalid input
- boundary values
- conflicting or duplicate actions
- authorization differences
- dependency timeout or failure
- concurrency or ordering issue
- data persistence or side effects
- rollback or partial failure

## Prioritization

- First: the narrowest layer that proves the contract clearly
- Next: one integration point when unit or service tests cannot prove the requirement alone
- Last: broad end-to-end coverage for critical journeys only

## Anti-Patterns

- Adding end-to-end tests for behavior already well-covered at lower layers
- Copying the same assertion across many layers without new signal
- Building a heavy global harness for a feature that only needs a local seam
