import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Inspect shipped JavaScript, including lazy-loaded Settings chunks, rather than
// trusting source-only checks or build-time environment configuration.
const assets = new URL('../../dist/assets/', import.meta.url);
const routes = ['/api/auth/linkedin/status?', '/api/auth/linkedin/connect?'];
const found = new Set();
for (const file of readdirSync(assets).filter(name => name.endsWith('.js'))) {
    const code = readFileSync(new URL(file, assets), 'utf8');
    for (const match of code.matchAll(/fetch\((["'`])([^"'`]+)\1/g)) {
        const target = match[2];
        for (const route of routes) {
            if (!target.includes(route)) continue;
            assert.ok(target.startsWith(route), `LinkedIn request must use the current origin: ${file}`);
            found.add(route);
        }
    }
}
for (const route of routes) assert.ok(found.has(route), `Missing verifiable built LinkedIn request: ${route}`);
console.log('Built LinkedIn status/connect requests use current origin');
