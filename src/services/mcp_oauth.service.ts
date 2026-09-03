import { createHash, randomBytes } from 'crypto';
import prisma from '../db';
import type { McpCapabilityProfile } from '../mcp/capabilities';

export const MCP_WORKSPACE_SCOPE = 'contentops:workspace';
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function opaqueToken(prefix: string) {
    return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function hashOAuthToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
}

export function pkceChallenge(verifier: string) {
    return createHash('sha256').update(verifier).digest('base64url');
}

export function validateRedirectUri(value: unknown) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
        const url = new URL(value);
        if (url.hash || url.username || url.password) return null;
        const loopbackHost = url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
        const loopback = loopbackHost && url.protocol === 'http:';
        const trustedHostedCallback = url.protocol === 'https:' && (
            url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')
            || url.hostname === 'openai.com' || url.hostname.endsWith('.openai.com')
        );
        if (!loopback && !trustedHostedCallback) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function normalizedScopes(value: unknown) {
    const scopes = String(value || MCP_WORKSPACE_SCOPE).split(/\s+/).filter(Boolean);
    if (scopes.length !== 1 || scopes[0] !== MCP_WORKSPACE_SCOPE) throw new Error('invalid_scope');
    return MCP_WORKSPACE_SCOPE;
}

function parseRedirectUris(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
}

type OAuthDatabase = typeof prisma;

export class McpOAuthService {
    constructor(private readonly db: OAuthDatabase = prisma, private readonly now: () => Date = () => new Date()) {}

    async registerClient(input: { client_name?: unknown; redirect_uris?: unknown }) {
        const requested = Array.isArray(input.redirect_uris) ? input.redirect_uris : [];
        if (!requested.length || requested.length > 5) throw new Error('invalid_redirect_uris');
        const redirectUris = requested.map(validateRedirectUri);
        if (redirectUris.some(uri => !uri) || new Set(redirectUris).size !== redirectUris.length) throw new Error('invalid_redirect_uris');
        const clientName = typeof input.client_name === 'string' && input.client_name.trim()
            ? input.client_name.trim().slice(0, 120)
            : 'Codex MCP client';
        const clientId = `mcp_client_${randomBytes(24).toString('base64url')}`;
        await this.db.mcpOAuthClient.create({
            data: { client_id: clientId, client_name: clientName, redirect_uris: redirectUris as string[] }
        });
        return {
            client_id: clientId,
            client_name: clientName,
            redirect_uris: redirectUris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code']
        };
    }

    async getAuthorizationRequest(input: {
        clientId: string; redirectUri: string; responseType: string; codeChallenge: string;
        codeChallengeMethod: string; resource: string; scope?: string;
    }) {
        if (input.responseType !== 'code' || input.codeChallengeMethod !== 'S256') throw new Error('invalid_request');
        if (!/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) throw new Error('invalid_request');
        const client = await this.db.mcpOAuthClient.findUnique({ where: { client_id: input.clientId } });
        const normalizedRedirect = validateRedirectUri(input.redirectUri);
        if (!client || !normalizedRedirect || !parseRedirectUris(client.redirect_uris).includes(normalizedRedirect)) throw new Error('invalid_client');
        return { client, redirectUri: normalizedRedirect, scope: normalizedScopes(input.scope), resource: input.resource };
    }

    async authorize(input: {
        userId: number; projectId: number; clientId: string; redirectUri: string; responseType: string;
        codeChallenge: string; codeChallengeMethod: string; resource: string; scope?: string;
    }) {
        const request = await this.getAuthorizationRequest(input);
        const membership = await this.db.projectMember.findUnique({
            where: { project_id_user_id: { project_id: input.projectId, user_id: input.userId } }
        });
        if (!membership || membership.role !== 'owner') throw new Error('owner_access_required');
        const code = opaqueToken('mcp_code');
        await this.db.mcpOAuthAuthorizationCode.create({
            data: {
                code_hash: hashOAuthToken(code),
                client_id: input.clientId,
                project_id: input.projectId,
                user_id: input.userId,
                redirect_uri: request.redirectUri,
                resource: input.resource,
                scope: request.scope,
                code_challenge: input.codeChallenge,
                expires_at: new Date(this.now().getTime() + AUTHORIZATION_CODE_TTL_MS)
            }
        });
        return { code, redirectUri: request.redirectUri };
    }

    async exchangeAuthorizationCode(input: {
        code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string;
    }) {
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new Error('invalid_grant');
        const normalizedRedirect = validateRedirectUri(input.redirectUri);
        if (!normalizedRedirect) throw new Error('invalid_grant');
        const accessToken = opaqueToken('mcp_oauth');
        const refreshToken = opaqueToken('mcp_refresh');
        const familyId = opaqueToken('mcp_family');
        const now = this.now();
        const record = await this.db.$transaction(async transaction => {
            const authorizationCode = await transaction.mcpOAuthAuthorizationCode.findUnique({ where: { code_hash: hashOAuthToken(input.code) } });
            if (!authorizationCode
                || authorizationCode.client_id !== input.clientId
                || authorizationCode.redirect_uri !== normalizedRedirect
                || authorizationCode.resource !== input.resource
                || authorizationCode.consumed_at
                || authorizationCode.expires_at <= now
                || authorizationCode.code_challenge !== pkceChallenge(input.codeVerifier)) {
                throw new Error('invalid_grant');
            }
            const consumed = await transaction.mcpOAuthAuthorizationCode.updateMany({
                where: { id: authorizationCode.id, consumed_at: null },
                data: { consumed_at: now }
            });
            if (consumed.count !== 1) throw new Error('invalid_grant');
            return transaction.mcpOAuthToken.create({
                data: {
                    family_id: familyId,
                    access_token_hash: hashOAuthToken(accessToken),
                    refresh_token_hash: hashOAuthToken(refreshToken),
                    client_id: input.clientId,
                    project_id: authorizationCode.project_id,
                    user_id: authorizationCode.user_id,
                    resource: authorizationCode.resource,
                    scope: authorizationCode.scope,
                    expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
                    refresh_expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS)
                }
            });
        });
        return this.tokenResponse(accessToken, refreshToken, record.scope);
    }

    async refresh(input: { refreshToken: string; clientId: string; resource: string }) {
        const nextAccessToken = opaqueToken('mcp_oauth');
        const nextRefreshToken = opaqueToken('mcp_refresh');
        const now = this.now();
        const record = await this.db.$transaction(async transaction => {
            const current = await transaction.mcpOAuthToken.findUnique({ where: { refresh_token_hash: hashOAuthToken(input.refreshToken) } });
            if (!current || current.client_id !== input.clientId || current.resource !== input.resource || current.refresh_expires_at <= now) {
                throw new Error('invalid_grant');
            }
            if (current.revoked_at) {
                await transaction.mcpOAuthToken.updateMany({
                    where: { family_id: current.family_id, revoked_at: null }, data: { revoked_at: now }
                });
                return null;
            }
            const revoked = await transaction.mcpOAuthToken.updateMany({ where: { id: current.id, revoked_at: null }, data: { revoked_at: now } });
            if (revoked.count !== 1) throw new Error('invalid_grant');
            return transaction.mcpOAuthToken.create({
                data: {
                    family_id: current.family_id,
                    access_token_hash: hashOAuthToken(nextAccessToken),
                    refresh_token_hash: hashOAuthToken(nextRefreshToken),
                    client_id: current.client_id,
                    project_id: current.project_id,
                    user_id: current.user_id,
                    resource: current.resource,
                    scope: current.scope,
                    expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
                    refresh_expires_at: current.refresh_expires_at
                }
            });
        });
        if (!record) throw new Error('invalid_grant');
        return this.tokenResponse(nextAccessToken, nextRefreshToken, record.scope);
    }

    async authenticate(token: string, expectedProfile: Exclude<McpCapabilityProfile, 'owner'>, expectedResource: string) {
        const now = this.now();
        const record = await this.db.mcpOAuthToken.findUnique({ where: { access_token_hash: hashOAuthToken(token) } });
        if (!record || record.resource !== expectedResource || record.revoked_at || record.expires_at <= now) return null;
        if (!record.scope.split(/\s+/).includes(MCP_WORKSPACE_SCOPE)) return null;
        const membership = await this.db.projectMember.findUnique({
            where: { project_id_user_id: { project_id: record.project_id, user_id: record.user_id } }
        });
        if (!membership || membership.role !== 'owner') return null;
        await this.db.mcpOAuthToken.update({ where: { id: record.id }, data: { last_used_at: now } });
        return {
            credentialId: `oauth:${record.id}:${record.access_token_hash}`,
            principal: { userId: record.user_id, actorId: `user:${record.user_id}`, projectId: record.project_id, profile: expectedProfile }
        };
    }

    async revoke(token: string, clientId?: string) {
        const hash = hashOAuthToken(token);
        await this.db.mcpOAuthToken.updateMany({
            where: {
                ...(clientId ? { client_id: clientId } : {}),
                revoked_at: null,
                OR: [{ access_token_hash: hash }, { refresh_token_hash: hash }]
            },
            data: { revoked_at: this.now() }
        });
    }

    async listProjectGrants(projectId: number) {
        return this.db.mcpOAuthToken.findMany({
            where: { project_id: projectId, revoked_at: null, refresh_expires_at: { gt: this.now() } },
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                scope: true,
                expires_at: true,
                refresh_expires_at: true,
                last_used_at: true,
                created_at: true,
                client: { select: { client_name: true } },
                user: { select: { id: true, name: true, email: true } }
            }
        });
    }

    async revokeProjectGrant(projectId: number, grantId: number) {
        const result = await this.db.mcpOAuthToken.updateMany({
            where: { id: grantId, project_id: projectId, revoked_at: null },
            data: { revoked_at: this.now() }
        });
        if (result.count !== 1) throw new Error('OAuth workspace connection was not found');
        return { revoked: true };
    }

    private tokenResponse(accessToken: string, refreshToken: string, scope: string) {
        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
            refresh_token: refreshToken,
            scope
        };
    }
}

export default new McpOAuthService();
