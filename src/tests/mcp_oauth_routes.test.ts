import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import mcpOAuthRoutes from '../routes/mcp_oauth.routes';
import mcpOAuthService from '../services/mcp_oauth.service';
import authService from '../services/auth.service';

test('OAuth discovery advertises authorization code, PKCE, DCR, refresh, and revocation', async () => {
    const app = Fastify();
    app.register(mcpOAuthRoutes);
    const response = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    assert.equal(response.statusCode, 200);
    const metadata = JSON.parse(response.body);
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(metadata.grant_types_supported, ['authorization_code', 'refresh_token']);
    assert.match(metadata.registration_endpoint, /\/oauth\/register$/);
    assert.match(metadata.revocation_endpoint, /\/oauth\/revoke$/);
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    await app.close();
});

test('authorization consent returns state and issuer without exposing Planner credentials', async () => {
    const originalVerify = authService.verifyToken;
    const originalAuthorize = mcpOAuthService.authorize;
    authService.verifyToken = () => ({ id: 22, email: 'member@example.com', name: 'Member' });
    mcpOAuthService.authorize = async () => ({ code: 'mcp_code_secret', redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' });
    const app = Fastify();
    app.register(mcpOAuthRoutes);
    try {
        const response = await app.inject({
            method: 'POST',
            url: '/api/oauth/authorize',
            headers: { authorization: 'Bearer planner-session' },
            payload: {
                client_id: 'client', redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
                response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256',
                resource: 'http://127.0.0.1:8080/mcp', project_id: 10, state: 'opaque-state'
            }
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['cache-control'], 'no-store');
        const redirect = new URL(JSON.parse(response.body).redirect_to);
        assert.equal(redirect.searchParams.get('code'), 'mcp_code_secret');
        assert.equal(redirect.searchParams.get('state'), 'opaque-state');
        assert.equal(redirect.searchParams.get('iss'), 'http://127.0.0.1:3003');
        assert.doesNotMatch(response.body, /planner-session|member@example/);
    } finally {
        authService.verifyToken = originalVerify;
        mcpOAuthService.authorize = originalAuthorize;
        await app.close();
    }
});

test('token endpoint rejects a mismatched MCP resource before issuing a token', async () => {
    const app = Fastify();
    app.register(mcpOAuthRoutes);
    const response = await app.inject({
        method: 'POST', url: '/oauth/token',
        payload: { grant_type: 'authorization_code', resource: 'https://attacker.example/mcp' }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).error, 'invalid_target');
    assert.equal(response.headers['cache-control'], 'no-store');
    await app.close();
});
