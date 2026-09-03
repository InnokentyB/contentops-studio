import test from 'node:test';
import assert from 'node:assert/strict';
import { McpOAuthService, hashOAuthToken, pkceChallenge, validateRedirectUri } from '../services/mcp_oauth.service';

function createFakeDb(role = 'owner') {
    let id = 0;
    const clients = new Map<string, any>();
    const codes = new Map<string, any>();
    const tokensByAccess = new Map<string, any>();
    const tokensByRefresh = new Map<string, any>();
    const db: any = {
        mcpOAuthClient: {
            create: async ({ data }: any) => {
                const row = { id: ++id, ...data };
                clients.set(row.client_id, row);
                return row;
            },
            findUnique: async ({ where }: any) => clients.get(where.client_id) || null
        },
        mcpOAuthAuthorizationCode: {
            create: async ({ data }: any) => {
                const row = { id: ++id, consumed_at: null, ...data };
                codes.set(row.code_hash, row);
                return row;
            },
            findUnique: async ({ where }: any) => codes.get(where.code_hash) || null,
            updateMany: async ({ where, data }: any) => {
                const row = Array.from(codes.values()).find((entry: any) => entry.id === where.id && entry.consumed_at === null);
                if (!row) return { count: 0 };
                Object.assign(row, data);
                return { count: 1 };
            }
        },
        mcpOAuthToken: {
            create: async ({ data }: any) => {
                const row = { id: ++id, revoked_at: null, last_used_at: null, ...data };
                tokensByAccess.set(row.access_token_hash, row);
                tokensByRefresh.set(row.refresh_token_hash, row);
                return row;
            },
            findUnique: async ({ where }: any) => where.access_token_hash
                ? tokensByAccess.get(where.access_token_hash) || null
                : tokensByRefresh.get(where.refresh_token_hash) || null,
            updateMany: async ({ where, data }: any) => {
                const rows = Array.from(tokensByAccess.values()).filter((entry: any) =>
                    (where.id ? entry.id === where.id : true)
                    && (where.family_id ? entry.family_id === where.family_id : true)
                    && (where.client_id ? entry.client_id === where.client_id : true)
                    && (where.revoked_at === null ? entry.revoked_at === null : true)
                    && (!where.OR || where.OR.some((condition: any) =>
                        condition.access_token_hash === entry.access_token_hash || condition.refresh_token_hash === entry.refresh_token_hash
                    ))
                );
                rows.forEach(row => Object.assign(row, data));
                return { count: rows.length };
            },
            update: async ({ where, data }: any) => {
                const row = Array.from(tokensByAccess.values()).find((entry: any) => entry.id === where.id);
                Object.assign(row, data);
                return row;
            }
        },
        projectMember: {
            findUnique: async () => ({ project_id: 10, user_id: 22, role })
        },
        $transaction: async (operation: any) => operation(db)
    };
    return { db, clients, codes, tokensByAccess, tokensByRefresh };
}

test('OAuth client registration accepts HTTPS and loopback callbacks but rejects unsafe redirects', async () => {
    assert.equal(validateRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'), 'https://chatgpt.com/connector_platform_oauth_redirect');
    assert.equal(validateRedirectUri('http://127.0.0.1:1455/callback'), 'http://127.0.0.1:1455/callback');
    assert.equal(validateRedirectUri('http://attacker.example/callback'), null);
    assert.equal(validateRedirectUri('https://attacker.example/callback'), null);
    assert.equal(validateRedirectUri('https://user:pass@example.com/callback'), null);

    const { db } = createFakeDb();
    const service = new McpOAuthService(db);
    await assert.rejects(
        service.registerClient({ redirect_uris: ['http://attacker.example/callback'] }),
        /invalid_redirect_uris/
    );
});

test('authorization code is project-owner scoped, PKCE protected, audience bound, and single use', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const { db, codes } = createFakeDb();
    const service = new McpOAuthService(db, () => now);
    const client = await service.registerClient({
        client_name: 'Codex',
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect']
    });
    const verifier = 'v'.repeat(43);
    const resource = 'https://planner-mcp.example/mcp';
    const authorization = await service.authorize({
        userId: 22,
        projectId: 10,
        clientId: client.client_id,
        redirectUri: client.redirect_uris[0]!,
        responseType: 'code',
        codeChallenge: pkceChallenge(verifier),
        codeChallengeMethod: 'S256',
        resource
    });
    assert.equal(codes.size, 1);
    assert.equal(codes.get(hashOAuthToken(authorization.code)).project_id, 10);

    await assert.rejects(service.exchangeAuthorizationCode({
        code: authorization.code,
        clientId: client.client_id,
        redirectUri: client.redirect_uris[0]!,
        codeVerifier: 'x'.repeat(43),
        resource
    }), /invalid_grant/);

    const issued = await service.exchangeAuthorizationCode({
        code: authorization.code,
        clientId: client.client_id,
        redirectUri: client.redirect_uris[0]!,
        codeVerifier: verifier,
        resource
    });
    assert.match(issued.access_token, /^mcp_oauth_/);
    assert.match(issued.refresh_token, /^mcp_refresh_/);
    assert.equal(issued.expires_in, 3600);
    await assert.rejects(service.exchangeAuthorizationCode({
        code: authorization.code,
        clientId: client.client_id,
        redirectUri: client.redirect_uris[0]!,
        codeVerifier: verifier,
        resource
    }), /invalid_grant/);

    assert.equal(await service.authenticate(issued.access_token, 'publisher', 'https://other.example/mcp'), null);
    const principal = await service.authenticate(issued.access_token, 'publisher', resource);
    assert.deepEqual(principal?.principal, { userId: 22, actorId: 'user:22', projectId: 10, profile: 'publisher' });
});

test('refresh rotates both tokens and a downgraded project member loses access', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const fake = createFakeDb();
    const service = new McpOAuthService(fake.db, () => now);
    const client = await service.registerClient({ redirect_uris: ['http://localhost:31337/callback'] });
    const verifier = 'a'.repeat(64);
    const resource = 'https://planner-mcp.example/mcp';
    const authorization = await service.authorize({
        userId: 22, projectId: 10, clientId: client.client_id, redirectUri: client.redirect_uris[0]!,
        responseType: 'code', codeChallenge: pkceChallenge(verifier), codeChallengeMethod: 'S256', resource
    });
    const first = await service.exchangeAuthorizationCode({
        code: authorization.code, clientId: client.client_id, redirectUri: client.redirect_uris[0]!, codeVerifier: verifier, resource
    });
    const second = await service.refresh({ refreshToken: first.refresh_token, clientId: client.client_id, resource });
    assert.notEqual(second.access_token, first.access_token);
    assert.equal(await service.authenticate(first.access_token, 'planner', resource), null);
    assert.ok(await service.authenticate(second.access_token, 'planner', resource));
    await assert.rejects(service.refresh({ refreshToken: first.refresh_token, clientId: client.client_id, resource }), /invalid_grant/);
    assert.equal(await service.authenticate(second.access_token, 'planner', resource), null, 'refresh-token replay revokes the active token family');

    const thirdFlow = await service.authorize({
        userId: 22, projectId: 10, clientId: client.client_id, redirectUri: client.redirect_uris[0]!,
        responseType: 'code', codeChallenge: pkceChallenge(verifier), codeChallengeMethod: 'S256', resource
    });
    const third = await service.exchangeAuthorizationCode({
        code: thirdFlow.code, clientId: client.client_id, redirectUri: client.redirect_uris[0]!, codeVerifier: verifier, resource
    });
    fake.db.projectMember.findUnique = async () => ({ project_id: 10, user_id: 22, role: 'viewer' });
    assert.equal(await service.authenticate(third.access_token, 'planner', resource), null);
});

test('workspace OAuth authorization is denied to non-owner members', async () => {
    const { db } = createFakeDb('editor');
    const service = new McpOAuthService(db);
    const client = await service.registerClient({ redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] });
    await assert.rejects(service.authorize({
        userId: 22, projectId: 10, clientId: client.client_id, redirectUri: client.redirect_uris[0]!,
        responseType: 'code', codeChallenge: pkceChallenge('z'.repeat(43)), codeChallengeMethod: 'S256',
        resource: 'https://planner-mcp.example/mcp'
    }), /owner_access_required/);
});

test('project grant management lists no token hashes and revokes only within the project', async () => {
    let listQuery: any;
    let revokeQuery: any;
    const db: any = {
        mcpOAuthToken: {
            findMany: async (query: any) => { listQuery = query; return []; },
            updateMany: async (query: any) => { revokeQuery = query; return { count: 1 }; }
        }
    };
    const service = new McpOAuthService(db, () => new Date('2026-09-03T12:00:00Z'));
    assert.deepEqual(await service.listProjectGrants(10), []);
    assert.equal(listQuery.where.project_id, 10);
    assert.equal(listQuery.select.access_token_hash, undefined);
    assert.equal(listQuery.select.refresh_token_hash, undefined);
    assert.deepEqual(await service.revokeProjectGrant(10, 99), { revoked: true });
    assert.deepEqual(revokeQuery.where, { id: 99, project_id: 10, revoked_at: null });
});
