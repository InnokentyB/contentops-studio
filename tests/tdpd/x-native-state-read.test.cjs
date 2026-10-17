const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.SHARED_BROWSER_DIST || '/opt/planner/dist';
const { isToolAllowedForProfile, } = require(path.join(base, 'mcp/capabilities.js'));
const { registerXNativeTools } = require(path.join(base, 'mcp/tools/x_native_tools.js'));
const { scopeRemoteMcpRequest } = require(path.join(base, 'mcp/remote-auth.js'));
const { getXNativeState } = require(path.join(base, 'services/x_native_diagnostics.js'));
const { nativeStateRequestSchema, checkedNativeStateResponse, nativeStateReadError } = require(path.join(base, 'services/x_native_diagnostics_contract.js'));
const { projectNativeBinding } = require(path.join(base, 'services/x_native_diagnostics_binding.js'));
const args = { projectId: 7, channelId: 8, taskId: 9, actorId: 'user:2', candidateInstallationId: '0'.repeat(64) };

test('READ-01: read-only native state command is visible only to enabled Owner/Publisher', () => {
    const registered = new Map();
    registerXNativeTools({ registerTool: (name, spec, handler) => registered.set(name, { spec, handler }) }, true);
    assert.ok(registered.has('ba_get_x_native_state'), 'approved read-only command is not implemented');
    const { spec } = registered.get('ba_get_x_native_state');
    assert.deepEqual(spec.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal(spec.inputSchema.safeParse({ ...args, apply: true }).success, false, 'SDK must receive the strict schema, not a stripping raw shape');
    assert.equal(isToolAllowedForProfile('publisher', 'ba_get_x_native_state'), true);
    assert.equal(isToolAllowedForProfile('owner', 'ba_get_x_native_state'), true);
    for (const role of ['planner', 'strategist', 'writer', 'editor', 'art_director', 'growth_analyst', 'organization_researcher']) {
        assert.equal(isToolAllowedForProfile(role, 'ba_get_x_native_state'), false);
    }
    const disabled = new Map();
    registerXNativeTools({ registerTool: (name, spec) => disabled.set(name, spec) }, false);
    assert.equal(disabled.has('ba_get_x_native_state'), false);
});

test('READ-02/03: exact principal binding and strict bounded request reject caller overrides and extra controls', () => {
    const body = { method: 'tools/call', params: { name: 'ba_get_x_native_state', arguments: { ...args, actorId: 'user:999' } } };
    const principal = { userId: 2, actorId: 'user:2', projectId: 7, profile: 'publisher' };
    assert.equal(scopeRemoteMcpRequest(body, principal).body.params.arguments.actorId, 'user:2');
    assert.equal(scopeRemoteMcpRequest(body, { ...principal, projectId: 99 }).allowed, false);
    assert.equal(scopeRemoteMcpRequest(body, { ...principal, profile: 'planner' }).allowed, false);
    assert.equal(nativeStateRequestSchema.safeParse(args).success, true);
    for (const invalid of [{ ...args, cursor: 'next' }, { ...args, limit: 1 }, { ...args, apply: false },
        { ...args, nonce: '0'.repeat(64) }, { ...args, projectId: 2147483648 }, { ...args, actorId: 'user:2147483648' },
        { ...args, candidateInstallationId: 'A'.repeat(64) }]) assert.equal(nativeStateRequestSchema.safeParse(invalid).success, false);
});

test('READ-01/03: real MCP SDK advertises a strict schema and rejects extras before the service', async () => {
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    const service = require(path.join(base, 'services/x_native_diagnostics.js')), original = service.getXNativeState;
    let calls = 0;
    service.getXNativeState = async () => { calls++; return { mutatesState: false, providerCalled: false }; };
    const server = new McpServer({ name: 'synthetic-state-read', version: '1' });
    const client = new Client({ name: 'synthetic-client', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
        registerXNativeTools(server, true); await server.connect(a); await client.connect(b);
        const listed = (await client.listTools()).tools.find(tool => tool.name === 'ba_get_x_native_state');
        assert.equal(listed.inputSchema.additionalProperties, false);
        for (const extra of [{ apply: true }, { cursor: 'next' }, { limit: 20 }]) {
            const result = await client.callTool({ name: listed.name, arguments: { ...args, ...extra } });
            assert.equal(result.isError, true);
        }
        assert.equal(calls, 0);
        assert.notEqual((await client.callTool({ name: listed.name, arguments: args })).isError, true);
        assert.equal(calls, 1);
    } finally { service.getXNativeState = original; await client.close(); await server.close(); }
});

test('READ-03/10: off/input/response bounds and redacted error DTO before any DB access', async () => {
    const deps = { enabled: () => false, db: { $transaction: () => { throw Error('DB MUST NOT BE CALLED'); } } };
    await assert.rejects(getXNativeState(args, deps), /PILOT_DISABLED/);
    await assert.rejects(getXNativeState({ ...args, apply: true }, { ...deps, enabled: () => true }), /STATE_INVALID_INPUT/);
    assert.throws(() => checkedNativeStateResponse({ large: 'x'.repeat(32769) }), /STATE_RESPONSE_LIMIT/);
    const error = nativeStateReadError(Error('private-token-and-provider-payload'));
    assert.deepEqual(Object.keys(error).sort(), ['code', 'mutatesState', 'providerCalled']);
    assert.ok(!JSON.stringify(error).includes('private-token'));
});

test('READ-04: binding is deterministic, exact-case and administrative only', () => {
    const source = { channelActive: false, configKind: 'object', accountRef: '@synthetic', accountType: null,
        profileUrl: null, channelUrl: 'https://x.com/synthetic/', rawAccountUrl: null,
        identityKind: 'object', platform: 'x', boundType: 'personal', boundAccount: '@synthetic',
        boundProfile: 'https://x.com/synthetic', boundProvider: 'synthetic' };
    assert.deepEqual(projectNativeBinding(source), { channelActive: false, status: 'consistent' });
    assert.equal(projectNativeBinding({ ...source, identityKind: null, platform: null, boundType: null,
        boundAccount: null, boundProfile: null, boundProvider: null }).status, 'unbound');
    assert.equal(projectNativeBinding({ ...source, accountRef: null }).status, 'unbound');
    for (const invalid of [{ boundAccount: '@Synthetic' }, { identityKind: 'string' }, { profileUrl: '__invalid__' },
        { boundProvider: 'different' }, { accountType: 'company_page' }]) {
        assert.equal(projectNativeBinding({ ...source, ...invalid }).status, 'inconsistent');
    }
});
