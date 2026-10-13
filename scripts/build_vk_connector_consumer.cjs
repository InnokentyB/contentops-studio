'use strict';
const path = require('node:path');
const fs = require('node:fs');

// Reuse the pinned frontend build tool. The resulting file needs no checkout/node_modules.
const esbuild = require('../frontend/node_modules/esbuild');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'dist', 'connector', 'vk_connector_consumer.cjs');
fs.mkdirSync(path.dirname(destination), { recursive: true });
esbuild.buildSync({ absWorkingDir: root, entryPoints: ['src/workers/vk_connector_consumer.ts'],
    // Mixing import/require Zod graphs through lazy worker imports can initialize SDK schemas
    // before ESM constructors. Pin every public Zod entry and SDK client to the CJS graph.
    alias: {
        zod: require.resolve('zod'),
        'zod/v3': require.resolve('zod/v3'),
        'zod/v4': require.resolve('zod/v4'),
        'zod/v4/core': require.resolve('zod/v4/core'),
        'zod/v4/mini': require.resolve('zod/v4/mini'),
        'zod/v4-mini': require.resolve('zod/v4-mini'),
        '@modelcontextprotocol/sdk/client/index.js': require.resolve('@modelcontextprotocol/sdk/client/index.js'),
        '@modelcontextprotocol/sdk/client/streamableHttp.js': require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')
    },
    bundle: true, platform: 'node', target: 'node20', format: 'cjs', outfile: destination,
    sourcemap: false, logLevel: 'warning' });
process.stdout.write('Standalone consumer built; provider admission remains blocked. No credential or profile included.\n');
