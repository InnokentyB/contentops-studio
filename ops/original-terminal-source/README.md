# Read-only original terminal-source collector, version 1

This collector verifies the observed Codex JSONL schema against a complete original turn. It checks contiguous ordinal boundaries, unique CUA declarations and matching final events, original thread/turn scope, supported terminal statuses and event ordering. Its output contains only bounded operation identities, statuses, ordinals, argument hashes and four explicit false authority flags. It does not review the argument semantics, prove absence of detached work, authenticate mutable local files, prove provider absence or grant recovery authority. The production adapter must independently authenticate provenance and apply the real runtime contract; do not promote this observation into a fictitious stop/drain ACK.

Test/build check (no installation or compilation needed):

`docker compose -f ops/original-cua-controller-20261025/terminal-source/compose.yaml run --rm checks`

All 8 isolated tests passed using reviewed linux/amd64 image planner-original-cua-integration:20261025, no network/credentials, read-only mount. No persistent service, port or volume is created; temporary container is removed. Stdout contains test/observation data, stderr only fixed error codes. Existing archives are opened read-only, never modified. CLI arguments are archive path, original turn ID, original thread ID. Real Mac archive conformance is pending and must be reported separately from synthetic checks.
