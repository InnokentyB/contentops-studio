# Test Scenario Catalog

Use the categories below to build a practical TDD-first scenario list.

## Core Behavior

- Primary success path
- Alternate valid flows
- State created or updated correctly
- Response or output format is correct

## Validation

- Missing required fields
- Invalid format or type
- Boundary values: min, max, just below, just above
- Unsupported combinations of inputs

## Business Rules

- Rule satisfied
- Rule violated
- Conflicting rule precedence
- Derived values or calculations

## State Transitions

- Valid transition from each relevant starting state
- Invalid transition is blocked clearly
- Repeated action is idempotent or rejected as specified
- Concurrent or overlapping updates behave predictably

## Permissions and Actor Differences

- Authorized actor succeeds
- Unauthorized actor is blocked
- Wrong tenant or wrong ownership is blocked
- Read-only versus write-capable roles differ as expected

## Integration and Failure Modes

- Upstream dependency success
- Timeout or transient failure
- Permanent failure
- Duplicate delivery or retry
- Out-of-order event arrival

## Regression-Prone Corners

- Empty result sets
- Large payloads or long lists
- Special characters or normalization issues
- Time zone, locale, and date boundaries
- Partial success and rollback behavior

## Prioritization Rule

Start with tests that prove the feature contract and the highest-risk failures. Add breadth only after the critical behavior is pinned down.
