# Open Questions Framework

Use these categories to extract clarification questions that prevent test churn and inconsistent implementation.

## Product Semantics

- What exact outcome should the user observe?
- Which business rule wins when two rules conflict?
- Which cases are invalid versus merely unusual?

## State and Lifecycle

- What is the initial state?
- Which transitions are allowed?
- Can an action be retried, undone, or repeated?
- What happens after partial success?

## Actor and Permission Model

- Which actors can trigger this behavior?
- How should behavior differ by role, tenant, owner, or environment?
- What should unauthorized callers see?

## Data and Validation

- Which fields are required, optional, or derived?
- What are the accepted ranges, formats, and normalization rules?
- Which invalid inputs should produce distinct errors?

## External Behavior

- Which dependency failures should be surfaced versus retried silently?
- Is the behavior immediate or eventual?
- What guarantees exist around ordering and duplication?

## Quality Bar

- Which scenarios are mandatory before coding starts?
- Which scenarios can be deferred to a later test cycle?
- What would make a test too brittle or too tied to implementation details?
