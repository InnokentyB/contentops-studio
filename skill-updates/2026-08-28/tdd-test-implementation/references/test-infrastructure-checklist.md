# Test Infrastructure Checklist

Use this checklist to decide whether the project is ready for feature-level TDD.

## Existing Tooling

- Which language and framework does the repo use?
- Which package manager or build tool is present?
- Is there already a test runner configured?
- Are there existing test files, helpers, fixtures, or mocks?
- Is there a documented or discoverable test command?

## Configuration Readiness

- Are test scripts declared in package manifests or build files?
- Are environment variables or test env files required?
- Are module aliases, transpilation, or path resolution configured for tests?
- Are database, queue, or cache dependencies isolated for test runs?

## Execution Reliability

- Can tests run locally without external manual steps?
- Are there flaky external dependencies that should be mocked or faked?
- Are test data setup and cleanup deterministic?
- Can the target feature be tested without booting the full system?

## Minimal Bootstrap Actions

Only add what is required for the feature:
- test runner and assertion library
- configuration file
- basic test script or command
- fixture or helper utilities
- isolated test environment setup
- documentation comments inside config only when needed

## Stop Conditions

If adding infrastructure would require a broad architectural rewrite, state that clearly and create the smallest safe seam instead of overbuilding a framework.
