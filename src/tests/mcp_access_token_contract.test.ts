import test from 'node:test';
import assert from 'node:assert/strict';
import { hashMcpToken, isManagedMcpProfile } from '../services/mcp_access_token.service';

test('personal MCP tokens are stored as deterministic hashes, not plaintext', () => {
    const token = 'mcp_example-secret';
    assert.notEqual(hashMcpToken(token), token);
    assert.equal(hashMcpToken(token), hashMcpToken(token));
    assert.equal(hashMcpToken(token).length, 64);
});

test('only scoped agent profiles can receive personal MCP access', () => {
    assert.equal(isManagedMcpProfile('planner'), true);
    assert.equal(isManagedMcpProfile('writer'), true);
    assert.equal(isManagedMcpProfile('art_director'), true);
    assert.equal(isManagedMcpProfile('owner'), false);
});
