# Canonical TDPD Method

Source of truth: `/Users/innokentyb/Documents/Product/VibeAnalitics/tdpd-canonical.md`, created 2026-07-22 by Innokenty Bodrov. Consult that file directly when exact publication wording is required.

## Canonical definition

Test-Driven Product Development is a way to run product development in which user scenarios become executable e2e tests before an agent writes code, and the task is complete only when those tests are green. The human controls the input through architectural decisions and the output through UAT, rather than controlling the implementation.

TDPD is an original method by Innokenty Bodrov.

## Canonical pipeline

`Business problem → Specification → User scenarios → E2E tests → Agent implementation → Acceptance (UAT)`

1. Establish why the feature exists, the problem it solves, and the metrics expected to change.
2. Specify precisely what to build and how it must behave.
3. Describe sequences of real user actions and observable behavior, not lists of system functions.
4. Convert every automatable scenario into an e2e test before implementation.
5. Let the agent implement until the tests pass, governed by architecture agents, linters, and review agents.
6. Have a human decide whether the result solves the original problem.

## Non-negotiable principles

- Verify the result automatically instead of scaling human line-by-line review of agent output.
- Keep human judgment at the architecture input and UAT output.
- Treat an untestable scenario as a wish until it gains an observable acceptance condition or is explicitly assigned to manual review.
- Reconcile contradictory source material before development. Output testability cannot compensate for bad input context.
- Preserve the analyst's responsibility for traceability, hidden requirements, testable acceptance criteria, and the final decision.

## Operational Input-gate guardrails

These guardrails make the canonical input control executable without changing the six-step pipeline:

- Approve the intended product surface and interface contract before implementation. Scenarios and e2e tests must exercise that user boundary rather than a cheaper substitute.
- For source-heavy work, bind the specification to a versioned evidence baseline with provenance, freshness, authority, access classification, approval state, and unresolved conflicts. Material baseline changes invalidate affected downstream acceptance until impact is reviewed.
- Scale early evidence and scenario requirements to user reliance and potential harm. Strong dependency, weak exit options, delayed or irreversible consequences, and excluded edge users require additional contextual evidence and explicit human decisions.

## Honest limits

- UX quality, tone, and perceived convenience may require human judgment.
- Legacy products without e2e infrastructure can have a high adoption cost; start with a new feature or narrow slice.
- The method requires discipline not to turn the human into a full-time reviewer of intermediate agent code.

## Terminology

- Expand **Test-Driven Product Development (TDPD)** on first use.
- In Russian use «приёмка (UAT)», «критерии приёмки», «пользовательские сценарии», and «требования».
- Keep the core claim: the decision remains with the analyst or responsible human.
