set -eu
mkdir -p /tmp/project
cp -R /source/prisma /source/src /source/scripts /source/tests /source/ops /tmp/project/
cp /source/tsconfig.json /source/prisma.config.ts /source/package.json /tmp/project/
ln -s /opt/planner/node_modules /tmp/project/node_modules
cd /tmp/project
/opt/planner/node_modules/.bin/tsc -p tsconfig.json
if [ "${EGRESS_RESTART_ONLY:-0}" = 1 ]; then
  node node_modules/prisma/build/index.js db push
  node --test tests/egress/redis.restart.cjs
  exit
fi
node --test tests/egress/*.test.cjs
if [ "${EGRESS_POSTGRES:-0}" = 1 ]; then
  node node_modules/prisma/build/index.js db push
  node --test tests/egress/*.pg.cjs
fi
node --test --test-concurrency=1 dist/tests/mcp_access_token_contract.test.js dist/tests/remote_mcp_auth.test.js dist/tests/mcp_organization_researcher_profile.test.js
