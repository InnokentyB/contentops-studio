'use strict';
const path = require('node:path');
const fs = require('node:fs');

// Reuse the pinned frontend build tool. The resulting file needs no checkout/node_modules.
const esbuild = require('../frontend/node_modules/esbuild');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'dist', 'connector', 'vk_connector_consumer.cjs');
fs.mkdirSync(path.dirname(destination), { recursive: true });
esbuild.buildSync({ absWorkingDir: root, entryPoints: ['src/workers/vk_connector_consumer.ts'],
    bundle: true, platform: 'node', target: 'node20', format: 'cjs', outfile: destination,
    sourcemap: false, logLevel: 'warning' });
process.stdout.write('Standalone infrastructure-only consumer built. No credential or profile included.\n');
