#!/bin/sh
# Run ONLY inside the reviewed tests container with a synthetic database.
set -eu
node --test --test-concurrency=1 \
 /workspace/tests/tdpd/browser-recovery-boundary.test.cjs \
 /workspace/tests/tdpd/browser-recovery-postgres.test.cjs \
 /workspace/tests/tdpd/shared-browser-release.test.cjs \
 /workspace/tests/tdpd/shared-browser-execution.test.cjs \
 /workspace/tests/tdpd/shared-browser-confirmation.test.cjs \
 /workspace/tests/tdpd/shared-browser-fences.test.cjs \
 /workspace/tests/tdpd/shared-browser-mcp.test.cjs \
 /workspace/tests/tdpd/shared-setka-browser.test.cjs \
 /workspace/tests/tdpd/shared-browser-diagnostics.test.cjs \
 /workspace/tests/tdpd/shared-browser-linkedin-text-only.test.cjs \
 /workspace/tests/tdpd/shared-x-native.test.cjs \
 /workspace/tests/tdpd/x-native-bridge.test.cjs \
 /workspace/tests/tdpd/shared-browser-postgres.test.cjs \
 /workspace/tests/tdpd/x-native-postgres.test.cjs \
 /opt/planner/dist/tests/browser_recovery_coordinator.test.js \
 /opt/planner/dist/tests/browser_recovery_resume.test.js \
 /opt/planner/dist/tests/browser_recovery_resume_repository.test.js \
 /opt/planner/dist/tests/browser_actionable_diagnostics.test.js \
 /opt/planner/dist/tests/publication_adapter_mcp_diagnostics.test.js \
 /opt/planner/dist/tests/remote_mcp_auth.test.js \
 /opt/planner/dist/tests/publication_diagnostic_result.test.js \
 /opt/planner/dist/tests/exact_owned_route_guard.test.js
