const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const base = process.env.SHARED_BROWSER_DIST || '/opt/planner/dist';
const { isToolAllowedForProfile } = require(base + '/mcp/capabilities.js');
const { scopeRemoteMcpRequest } = require(base + '/mcp/remote-auth.js');
const names = ['ba_issue_x_native_pairing', 'ba_register_x_native_installation',
    'ba_revoke_x_native_installation', 'ba_issue_x_native_challenge'];

test('X CI runs source-backed checks from the mounted repository rather than the compiled image cwd', () => {
    const pipeline = require('js-yaml').load(readFileSync('.github/workflows/code-quality.yml', 'utf8'));
    const step = pipeline.jobs['shared-browser-contract'].steps.find(row => row.name?.startsWith('Signed X bridge'));
    assert.ok(step);
    assert.match(step.run, /run --rm -w \/workspace build-check/);
    assert.match(step.run, /x-native-sandbox-boundary\.test\.cjs/);
});

test('X controls are wired into real registries, gated default-off, with no executor RPC', () => {
    const app = readFileSync('src/server.ts', 'utf8');
    const registry = readFileSync('src/mcp/shared.ts', 'utf8');
    assert.match(app, /import xNativeRoutes from ['"]\.\/routes\/x_native\.routes['"]/);
    assert.match(app, /server\.register\(xNativeRoutes\)/);
    assert.match(registry, /registerXNativeTools\(server\)/);
    assert.match(readFileSync('.env.example', 'utf8'), /^X_NATIVE_PILOT_ENABLED="false"$/m);
    const controls = require(base + '/mcp/tools/x_native_tools.js');
    const registered = [];
    const server = { registerTool(name) { registered.push(name); } };
    controls.registerXNativeTools(server, false); assert.deepEqual(registered, []);
    controls.registerXNativeTools(server, true); assert.deepEqual(registered, names);
});

test('only owner/Publisher can invoke control plane; remote principal rebinds flat actor/project', () => {
    for (const name of names) {
        assert.equal(isToolAllowedForProfile('owner', name), true);
        assert.equal(isToolAllowedForProfile('publisher', name), true);
        for (const profile of ['planner', 'strategist', 'writer', 'editor', 'art_director', 'growth_analyst', 'organization_researcher']) {
            assert.equal(isToolAllowedForProfile(profile, name), false);
        }
        const request = { method: 'tools/call', params: { name, arguments: { projectId: 301, actorId: 'user:999' } } };
        const principal = { projectId: 301, userId: 4, actorId: 'user:4', profile: 'publisher' };
        const allowed = scopeRemoteMcpRequest(request, principal);
        assert.equal(allowed.allowed, true); assert.equal(allowed.body.params.arguments.actorId, 'user:4');
        assert.equal(scopeRemoteMcpRequest(request, { ...principal, projectId: 302 }).allowed, false);
    }
});
