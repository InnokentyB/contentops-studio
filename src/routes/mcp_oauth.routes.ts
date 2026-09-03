import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import mcpOAuthService, { MCP_WORKSPACE_SCOPE } from '../services/mcp_oauth.service';

function withoutTrailingSlash(value: string) {
    return value.replace(/\/+$/, '');
}

export function getOAuthIssuer() {
    return withoutTrailingSlash(process.env.OAUTH_ISSUER_URL || process.env.APP_PUBLIC_URL || 'http://127.0.0.1:3003');
}

export function getMcpResource() {
    const configured = process.env.MCP_PUBLIC_RESOURCE || process.env.MCP_REMOTE_URL || 'http://127.0.0.1:8080/mcp';
    return withoutTrailingSlash(configured);
}

function bearerToken(headerValue: string | string[] | undefined) {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return raw?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

function oauthError(reply: any, status: number, error: string, description?: string) {
    reply.header('Cache-Control', 'no-store');
    return reply.code(status).send({ error, ...(description ? { error_description: description } : {}) });
}

function authorizationInput(source: any) {
    return {
        clientId: String(source.client_id || ''),
        redirectUri: String(source.redirect_uri || ''),
        responseType: String(source.response_type || ''),
        codeChallenge: String(source.code_challenge || ''),
        codeChallengeMethod: String(source.code_challenge_method || ''),
        resource: String(source.resource || ''),
        scope: source.scope ? String(source.scope) : undefined
    };
}

export default async function mcpOAuthRoutes(fastify: FastifyInstance) {
    const issuer = getOAuthIssuer();
    const resource = getMcpResource();

    fastify.get('/.well-known/oauth-authorization-server', async (_request, reply) => ({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        token_endpoint_auth_methods_supported: ['none'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [MCP_WORKSPACE_SCOPE],
        authorization_response_iss_parameter_supported: true
    }));

    fastify.post('/oauth/register', async (request, reply) => {
        try {
            const result = await mcpOAuthService.registerClient(request.body as any);
            reply.header('Cache-Control', 'no-store');
            return reply.code(201).send(result);
        } catch (error: any) {
            return oauthError(reply, 400, 'invalid_client_metadata', error.message);
        }
    });

    fastify.get('/api/oauth/request', async (request, reply) => {
        try {
            const input = authorizationInput(request.query as any);
            if (input.resource !== resource) return oauthError(reply, 400, 'invalid_target');
            const result = await mcpOAuthService.getAuthorizationRequest(input);
            return {
                client_name: result.client.client_name,
                scope: result.scope,
                resource: result.resource,
                issuer
            };
        } catch (error: any) {
            return oauthError(reply, 400, error.message === 'invalid_client' ? 'invalid_client' : 'invalid_request');
        }
    });

    fastify.post('/api/oauth/authorize', async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        if (!token) return oauthError(reply, 401, 'login_required');
        try {
            const user = authService.verifyToken(token);
            const body = request.body as any;
            const input = authorizationInput(body);
            if (input.resource !== resource) return oauthError(reply, 400, 'invalid_target');
            const result = await mcpOAuthService.authorize({ ...input, userId: user.id, projectId: Number(body.project_id) });
            const redirect = new URL(result.redirectUri);
            redirect.searchParams.set('code', result.code);
            if (body.state) redirect.searchParams.set('state', String(body.state));
            redirect.searchParams.set('iss', issuer);
            reply.header('Cache-Control', 'no-store');
            return { redirect_to: redirect.toString() };
        } catch (error: any) {
            const code = error.message === 'owner_access_required' ? 'access_denied' : 'invalid_request';
            return oauthError(reply, code === 'access_denied' ? 403 : 400, code);
        }
    });

    fastify.post('/oauth/token', async (request, reply) => {
        const body = request.body as any;
        if (String(body.resource || '') !== resource) return oauthError(reply, 400, 'invalid_target');
        try {
            const result = body.grant_type === 'authorization_code'
                ? await mcpOAuthService.exchangeAuthorizationCode({
                    code: String(body.code || ''), clientId: String(body.client_id || ''),
                    redirectUri: String(body.redirect_uri || ''), codeVerifier: String(body.code_verifier || ''),
                    resource: String(body.resource)
                })
                : body.grant_type === 'refresh_token'
                    ? await mcpOAuthService.refresh({
                        refreshToken: String(body.refresh_token || ''), clientId: String(body.client_id || ''), resource: String(body.resource)
                    })
                    : null;
            if (!result) return oauthError(reply, 400, 'unsupported_grant_type');
            reply.header('Cache-Control', 'no-store');
            return result;
        } catch (error: any) {
            return oauthError(reply, 400, error.message === 'invalid_scope' ? 'invalid_scope' : 'invalid_grant');
        }
    });

    fastify.post('/oauth/revoke', async (request, reply) => {
        const body = request.body as any;
        if (body.token) await mcpOAuthService.revoke(String(body.token), body.client_id ? String(body.client_id) : undefined);
        reply.header('Cache-Control', 'no-store');
        return reply.code(200).send();
    });
}
