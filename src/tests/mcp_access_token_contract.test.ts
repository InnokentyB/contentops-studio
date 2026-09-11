import test from 'node:test';
import assert from 'node:assert/strict';
import mcpAccessTokenService, { ActiveMcpWorkspaceBundleError, MANAGED_MCP_PROFILES, hashMcpToken, isManagedMcpProfile, projectMcpNamespace } from '../services/mcp_access_token.service';
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

test('project MCP namespaces remain distinct even when project slugs are similar', () => {
    assert.equal(projectMcpNamespace({ id: 10, slug: 'Customer Project' }), 'contentops_customer_project_p10');
    assert.equal(projectMcpNamespace({ id: 29, slug: 'customer-project' }), 'contentops_customer_project_p29');
    assert.notEqual(
        projectMcpNamespace({ id: 10, slug: 'Customer Project' }),
        projectMcpNamespace({ id: 29, slug: 'customer-project' })
    );
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
        assert.equal(bundle.schema_version, '2.0');
        assert.equal(bundle.codex.server_namespace, 'contentops_customer_project_p10');
        assert.equal(bundle.codex.project_directory_name, 'customer_project-contentops-p10');
        assert.match(bundle.config.mcpServers.contentops_customer_project_p10_publisher.headers.Authorization, /^Bearer mcp_/);
        assert.equal('contentops-publisher' in bundle.config.mcpServers, false);
        assert.match(bundle.codex.project_config_toml, /\[mcp_servers\.contentops_customer_project_p10_publisher\]/);
        assert.match(bundle.codex.project_config_toml, /bearer_token_env_var = "CONTENTOPS_CUSTOMER_PROJECT_P10_PUBLISHER_TOKEN"/);
        assert.doesNotMatch(bundle.codex.project_config_toml, /Bearer mcp_|external@example\.com/);
        assert.match(bundle.codex.secrets_env, /^CONTENTOPS_CUSTOMER_PROJECT_P10_STRATEGIST_TOKEN=mcp_/m);
        assert.match(bundle.codex.secrets_env, /^CONTENTOPS_CUSTOMER_PROJECT_P10_GROWTH_ANALYST_TOKEN=mcp_/m);
        assert.equal(bundle.accesses.find((access) => access.profile === 'publisher')?.server_name, 'contentops_customer_project_p10_publisher');
        assert.equal(bundle.accesses.find((access) => access.profile === 'publisher')?.token_env_var, 'CONTENTOPS_CUSTOMER_PROJECT_P10_PUBLISHER_TOKEN');
        assert.match(bundle.bootstrap_prompt, /Do not create projectless role chats/);
        assert.match(bundle.bootstrap_prompt, /manifest project id is not 10/);
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
