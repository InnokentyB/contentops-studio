import test from 'node:test';
import assert from 'node:assert/strict';
import mcpAccessTokenService, { ActiveMcpWorkspaceBundleError, MANAGED_MCP_PROFILES, hashMcpToken, isManagedMcpProfile } from '../services/mcp_access_token.service';
import prisma from '../db';

test('personal MCP tokens are stored as deterministic hashes, not plaintext', () => {
    const token = 'mcp_example-secret';
    assert.notEqual(hashMcpToken(token), token);
    assert.equal(hashMcpToken(token), hashMcpToken(token));
    assert.equal(hashMcpToken(token).length, 64);
});

test('only scoped agent profiles can receive personal MCP access', () => {
    assert.deepEqual(MANAGED_MCP_PROFILES, [
        'strategist', 'planner', 'writer', 'editor', 'art_director', 'publisher', 'growth_analyst'
    ]);
    for (const profile of MANAGED_MCP_PROFILES) assert.equal(isManagedMcpProfile(profile), true);
    assert.equal(isManagedMcpProfile('owner'), false);
});

test('workspace bundle creates all seven hashed credentials in one transaction and returns plaintext once', async () => {
    const originalFindUnique = prisma.projectMember.findUnique;
    const originalTransaction = prisma.$transaction;
    const stored: Array<Record<string, unknown>> = [];
    (prisma.projectMember as any).findUnique = async () => ({
        project: { id: 10, name: 'Customer project', slug: 'customer-project' },
        user: { id: 22, name: 'External User', email: 'external@example.com' }
    });
    (prisma as any).$transaction = async (callback: any) => callback({
        $queryRawUnsafe: async () => [{ pg_advisory_xact_lock: null }],
        mcpAccessToken: {
            findFirst: async () => null,
            updateMany: async () => ({ count: 0 }),
            create: async ({ data }: any) => {
                stored.push(data);
                return { id: stored.length, ...data };
            }
        }
    });

    try {
        const expiresAt = new Date('2026-12-01T00:00:00Z');
        const bundle = await mcpAccessTokenService.createWorkspaceBundle(10, 22, 'Codex Cloud', 'https://planner.example/mcp/', { expiresAt });
        assert.equal(bundle.accesses.length, 7);
        assert.match(bundle.bundle_id, /^[0-9a-f-]{36}$/);
        assert.equal(stored.length, 7);
        assert.deepEqual(stored.map((row) => row.profile), MANAGED_MCP_PROFILES);
        for (const row of stored) {
            assert.match(String(row.token_hash), /^[a-f0-9]{64}$/);
            assert.equal('token' in row, false);
            assert.equal(row.project_id, 10);
            assert.equal(row.user_id, 22);
            assert.equal(row.bundle_id, bundle.bundle_id);
            assert.equal(row.expires_at, expiresAt);
        }
        assert.equal(bundle.accesses.find((access) => access.profile === 'growth_analyst')?.endpoint, 'https://planner.example/mcp/growth-analyst');
        assert.match(bundle.config.mcpServers['contentops-publisher'].headers.Authorization, /^Bearer mcp_/);
        assert.doesNotMatch(bundle.bootstrap_prompt, /Bearer mcp_|external@example\.com/);
    } finally {
        (prisma.projectMember as any).findUnique = originalFindUnique;
        (prisma as any).$transaction = originalTransaction;
    }
});

test('workspace bundle rejects accidental duplicates and rotates the active bundle atomically', async () => {
    const originalFindUnique = prisma.projectMember.findUnique;
    const originalTransaction = prisma.$transaction;
    (prisma.projectMember as any).findUnique = async () => ({
        project: { id: 10, name: 'Customer project', slug: 'customer-project' },
        user: { id: 22, name: 'External User', email: 'external@example.com' }
    });
    let revoked = 0;
    (prisma as any).$transaction = async (callback: any) => callback({
        $queryRawUnsafe: async () => [{ pg_advisory_xact_lock: null }],
        mcpAccessToken: {
            findFirst: async () => ({ bundle_id: 'active-bundle' }),
            updateMany: async () => ({ count: revoked = 7 }),
            create: async ({ data }: any) => ({ id: Math.random(), ...data })
        }
    });

    try {
        await assert.rejects(
            () => mcpAccessTokenService.createWorkspaceBundle(10, 22, '', 'https://planner.example/mcp'),
            (error: any) => error instanceof ActiveMcpWorkspaceBundleError && error.bundleId === 'active-bundle'
        );
        const rotated = await mcpAccessTokenService.createWorkspaceBundle(10, 22, '', 'https://planner.example/mcp', { rotate: true });
        assert.equal(revoked, 7);
        assert.notEqual(rotated.bundle_id, 'active-bundle');
    } finally {
        (prisma.projectMember as any).findUnique = originalFindUnique;
        (prisma as any).$transaction = originalTransaction;
    }
});
