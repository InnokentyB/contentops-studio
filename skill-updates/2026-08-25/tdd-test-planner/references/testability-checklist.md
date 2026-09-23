# Testability Checklist

Use this checklist to determine whether the requirements are ready to drive tests before code exists.

## Clarity

- Does each requirement describe observable behavior rather than intent only?
- Are the inputs, triggers, and expected outputs explicit?
- Are error conditions and rejection behavior defined?
- Are terms like "valid", "complete", "fast", or "supported" defined concretely?

## Consistency

- Do any requirements conflict with each other?
- Do examples imply behavior not stated in the rules?
- Are naming, statuses, and business terms used consistently?
- Could two engineers interpret the same rule differently?

## Observability

- What output proves the feature worked?
- What output proves the feature failed correctly?
- Which state changes must be visible to a caller, user, or downstream system?
- Are logs or side effects being confused with product behavior?

## Boundaries

- What are the minimum and maximum valid values?
- What happens with empty, null, duplicate, expired, or malformed input?
- What happens if the same action is repeated?
- Are permissions, tenancy, or actor-specific differences defined?

## Dependencies

- Which external services, jobs, webhooks, or scheduled processes affect behavior?
- What should happen if a dependency is slow, unavailable, or returns inconsistent data?
- What behavior is synchronous versus eventual?

## Readiness Signal

If several answers above are missing, classify the requirement as not TDD-ready and move the gaps into open questions.
