# TDD Test Writing Rules

Write tests that make the missing behavior obvious and keep the next implementation step small.

## Core Rules

- Start with the smallest failing test that captures meaningful behavior.
- Use descriptive names that encode the rule being proved.
- Keep arrange, act, and assert steps readable.
- Assert externally visible behavior: outputs, state, emitted events, persisted changes, or observable errors.
- Avoid asserting transient implementation details unless they are part of the contract.

## Red Phase Guidance

- A failing test should fail because the feature is not implemented or the rule is not satisfied.
- Avoid failures caused by broken setup, syntax errors, or missing unrelated infrastructure.
- If setup blocks the red phase, fix setup first and rerun.
- If multiple rules exist, introduce them incrementally instead of dumping a huge suite at once.

## Coverage Prompts

- success case
- invalid input or boundary rejection
- business rule enforcement
- state transition correctness
- permission or actor difference
- dependency failure or retry path
- regression-prone corner case

## Readability Bar

Another engineer should be able to infer the intended implementation behavior by reading the test names and assertions alone.
