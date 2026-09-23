---
name: tdpd
description: Apply Test-Driven Product Development (TDPD), Innokenty Bodrov's method for agentic product development in which product problems become precise specifications, observable user scenarios, and executable end-to-end tests before implementation. Use when Codex needs to plan or deliver a user-facing feature through the TDPD pipeline, translate requirements or acceptance criteria into e2e tests, coordinate test-first agent implementation, establish architecture and UAT gates, or explain and audit whether a development workflow follows TDPD rather than ordinary TDD.
---

# Test-Driven Product Development

Treat TDPD as a product-delivery contract, not as a synonym for TDD. Convert user scenarios into executable e2e tests before an agent writes production code. Consider the task complete only when those tests pass and a human accepts that the result solves the original business problem.

Read [references/canonical-method.md](references/canonical-method.md) whenever explaining, teaching, auditing, or materially adapting the method. Preserve its terminology and attribution.

## Choose the operating mode

- **Explain:** Describe the method without changing project files.
- **Plan:** Produce the problem statement, specification, scenarios, test matrix, architecture decisions, and UAT plan. Do not write implementation unless requested.
- **Deliver:** Execute the full pipeline, including tests and implementation, when the user asks to build or change the product.
- **Audit:** Compare an existing workflow or feature against every gate and report gaps with evidence.

Do not infer permission to implement from a request to explain, review, or plan.

## Run the six-step pipeline

### 1. Fix the business problem

State the user or business problem, affected actor, desired outcome, and expected metric or observable signal. Separate the problem from a proposed solution. If value is unclear, stop before implementation and surface the missing product decision.

### 2. Make the specification deterministic

Describe externally visible behavior, rules, data, dependencies, states, and constraints. Reconcile contradictory sources before tests or code. Record unresolved ambiguity explicitly; do not let the agent silently choose an interpretation.

For source-heavy work, build or request a source map and context pack before proceeding.

### 3. Write user scenarios

Express real sequences of user actions and observable system responses. Include the happy path plus relevant empty, invalid, permission, retry, duplicate, partial-failure, interruption, and recovery paths. Avoid internal implementation details.

Require every automated scenario to define:

- initial state and actor;
- user action or external event;
- observable result;
- persistence or side effects when relevant;
- clear pass/fail condition.

Mark qualities that cannot be judged reliably by automation—such as tone, perceived convenience, or visual taste—for human review instead of pretending they are executable.

### 4. Turn scenarios into e2e tests first

Map each test to a scenario and business rule. Reuse the project's existing e2e stack and conventions. Prove the red state: tests must fail because the requested behavior is absent, not because infrastructure is broken.

Use `$tdd-test-planner` to remove ambiguity and build the test matrix. Use `$tdd-test-implementation` to establish the smallest viable test infrastructure and implement the red tests. Prefer boundary-level e2e tests; add lower-level tests only where they improve diagnosis, speed, or coverage of deterministic rules.

If no practical e2e environment exists, report the entry cost and propose the smallest honest slice. Do not replace executable acceptance with prose while still calling the workflow TDPD.

### 5. Delegate implementation to the agent

Confirm the human-approved architecture boundary before production changes: components, interfaces, data ownership, security constraints, and material tradeoffs. Then use `$tdd-feature-implementation` to make the smallest coherent change that turns the tests green and refactor safely.

Use automated checks, architecture review, security review, and focused code review to govern implementation. Do not require a human to review every intermediate rewrite. Escalate contract conflicts, security issues, migrations, destructive actions, and missing authorization.

### 6. Run human UAT

Present the working result against the original problem, not merely a green test report. Ask the human decision-maker whether it solves the intended job in realistic use. Capture the UAT verdict and any gap as a new scenario or product decision.

Do not claim TDPD completion without both:

1. green executable scenarios; and
2. explicit human UAT acceptance.

If UAT has not happened, report **engineering complete, awaiting UAT**, not complete.

## Maintain traceability

Keep a lightweight chain:

`business problem → specification rule → user scenario → e2e test → implementation evidence → UAT verdict`

Use stable identifiers when the work has more than a few scenarios. Every material rule must reach at least one scenario or be explicitly marked manual/non-testable. Every e2e test must trace back to user value or a necessary safety constraint.

## Required gates

- **Input gate:** sources are reconciled; the specification is testable; architecture decisions that require human judgment are approved.
- **Red gate:** executable scenarios exist and fail for the intended missing behavior.
- **Green gate:** target e2e tests pass; relevant broader checks pass; no hard-stop security or data issue remains.
- **Output gate:** a human completes UAT against the original business problem.

Never bypass a gate silently. Report the exact gate and missing evidence when blocked.

## Default deliverables

For planning, provide:

1. business problem and success signal;
2. assumptions and open decisions;
3. architecture decision boundary;
4. scenario and e2e-test matrix;
5. manual UAT checks;
6. traceability and gate status.

For delivery, additionally report the failing-test evidence, implementation summary, passing-test evidence, broader verification, and UAT status.

## Preserve the method boundary

- TDD primarily governs implementation through developer tests; TDPD governs product delivery through executable user scenarios.
- Automated e2e checks verify observable output; they do not prove product value. UAT remains human.
- TDPD is tool-independent.
- The analyst remains responsible for testable acceptance criteria and traceability.
- Attribute the method as **TDPD / Test-Driven Product Development, an original method by Innokenty Bodrov** when publishing or teaching it.
