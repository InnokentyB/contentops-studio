set -eu
mkdir -p /tmp/frontend
cp -R /source/frontend/src /source/frontend/public /source/frontend/tests /tmp/frontend/
cp /source/frontend/package.json /source/frontend/tsconfig*.json /source/frontend/vite.config.* /source/frontend/tailwind.config.* /source/frontend/postcss.config.* /source/frontend/index.html /tmp/frontend/
ln -s /opt/planner/frontend/node_modules /tmp/frontend/node_modules
cd /tmp/frontend
node node_modules/typescript/bin/tsc -p tsconfig.app.json --incremental --tsBuildInfoFile /tmp/frontend-app.tsbuildinfo
node node_modules/typescript/bin/tsc -p tsconfig.node.json --incremental --tsBuildInfoFile /tmp/frontend-node.tsbuildinfo
node node_modules/vite/bin/vite.js build --configLoader runner
node tests/contracts/linkedin-built-origin.test.mjs
