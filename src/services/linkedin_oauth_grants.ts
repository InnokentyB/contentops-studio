import { z } from 'zod';
import { LinkedInOAuthError } from './linkedin_oauth_contract';

/** Introspection fields are protocol evidence; absent fields are never inferred from consent or editable config. */
export function verifyLinkedInIntrospection(value: Record<string, unknown>, clientId: string, now: number): { scopes: string[]; expiresAt: string } {
    if (typeof value.active !== 'boolean') throw new LinkedInOAuthError('LINKEDIN_OAUTH_INTROSPECTION_INVALID');
    if (!value.active) throw new LinkedInOAuthError('LINKEDIN_OAUTH_TOKEN_INACTIVE');
    if (typeof value.client_id !== 'string' || !value.client_id) throw new LinkedInOAuthError('LINKEDIN_OAUTH_TOKEN_CLIENT_MISSING');
    if (value.client_id !== clientId) throw new LinkedInOAuthError('LINKEDIN_OAUTH_TOKEN_CLIENT_MISMATCH');
    const expiry = z.number().int().positive().max(253402300799).safeParse(value.expires_at);
    if (!expiry.success) throw new LinkedInOAuthError('LINKEDIN_OAUTH_TOKEN_EXPIRY_INVALID');
    if (expiry.data * 1000 <= now) throw new LinkedInOAuthError('LINKEDIN_OAUTH_TOKEN_EXPIRED');
    if (typeof value.scope !== 'string' || !value.scope.trim()) throw new LinkedInOAuthError('LINKEDIN_OAUTH_TOKEN_SCOPES_MISSING');
    const scopes = [...new Set(value.scope.split(/[ ,]+/).filter(Boolean))];
    if (scopes.length > 100 || !scopes.every(scope => /^[A-Za-z0-9_]+$/.test(scope))) throw new LinkedInOAuthError('LINKEDIN_OAUTH_TOKEN_SCOPES_INVALID');
    if (!scopes.some(scope => scope === 'r_basicprofile' || scope === 'r_liteprofile')) throw new LinkedInOAuthError('LINKEDIN_OAUTH_PROFILE_SCOPE_REQUIRED');
    return { scopes, expiresAt: new Date(expiry.data * 1000).toISOString() };
}
