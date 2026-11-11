set -eu
# Reproduce hosted CI module resolution without downloads: two installed dependency trees.
mkdir -p /tmp/ci-source/tests/egress
cp -R /source/frontend /tmp/ci-source/
cp /source/tests/egress/agent-save-ui-fixture.tsx /source/tests/egress/agent-api-client.ts /tmp/ci-source/tests/egress/
ln -s /opt/planner/node_modules /tmp/ci-source/node_modules
ln -s /opt/planner/frontend/node_modules /tmp/ci-source/frontend/node_modules
cd /tmp/ci-source/frontend
AGENT_UI_SOURCE=/tmp/ci-source node "${AGENT_UI_BUILDER:-/source/ops/egress/build-agent-ui.cjs}"
