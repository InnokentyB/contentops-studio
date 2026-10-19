import { z } from 'zod';
import { LinkedInOAuthError, oauthConfiguration } from './linkedin_oauth_contract';
import { LinkedInConnectionMetadata } from './linkedin_connection_credentials';
const object = z.record(z.string(), z.unknown());
/** Fixed destinations, bounded response bytes/time; no raw provider payload ever crosses the error boundary. */
async function requestJson(url: string, init: RequestInit) { try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_PROVIDER_UNAVAILABLE');
    if (!response.body)
        throw Error();
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 65536)
                throw Error();
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel();
    }
    return object.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
catch (error) {
    if (error instanceof LinkedInOAuthError)
        throw error;
    throw new LinkedInOAuthError('LINKEDIN_OAUTH_PROVIDER_UNAVAILABLE');
} }
function headers(token: string) { return { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0', 'Linkedin-Version': '202609' }; }
/** One bounded author finder proves endpoint read access only; it never adopts historical posts as publication facts. */
async function verifyPostRead(token: string, authorUrn: string, scopes: string[], organization: boolean): Promise<boolean> {
    if (!scopes.includes(organization ? 'r_organization_social' : 'r_member_social')) return false;
    try {
        const query = new URLSearchParams({ q: 'author', author: authorUrn, count: '1' });
        const payload = await requestJson(`https://api.linkedin.com/rest/posts?${query}`, { headers: { ...headers(token), 'X-RestLi-Method': 'FINDER' } });
        return z.object({ elements: z.array(z.object({ author: z.literal(authorUrn), id: z.string().regex(/^urn:li:(share|ugcPost):[0-9]+$/) })).max(1), paging: z.object({ start: z.literal(0), count: z.literal(1), links: z.array(z.unknown()).max(10) }) }).safeParse(payload).success;
    } catch (error) {
        if (error instanceof LinkedInOAuthError) return false;
        throw error;
    }
}
export async function verifyOAuthCode(code: string, redirectUri: string, authorUrn: string | null, accountKind: string, expectedProfileSlug: string | null): Promise<{
    token: string;
    metadata: LinkedInConnectionMetadata;
}> {
    const config = oauthConfiguration();
    const post = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
    const exchanged = await requestJson('https://www.linkedin.com/oauth/v2/accessToken', post({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: config.clientId, client_secret: config.clientSecret }));
    const parsedToken = z.string().min(1).max(16384).safeParse(exchanged.access_token);
    if (!parsedToken.success)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_PROVIDER_UNAVAILABLE');
    const token = parsedToken.data;
    const introspection = await requestJson('https://www.linkedin.com/oauth/v2/introspectToken', post({ client_id: config.clientId, client_secret: config.clientSecret, token }));
    const grants = z.object({ active: z.literal(true), client_id: z.literal(config.clientId), expires_at: z.number().int().positive(), scope: z.string().min(1) }).safeParse(introspection);
    if (!grants.success || grants.data.expires_at * 1000 <= Date.now())
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_GRANTS_UNKNOWN');
    const scopes = [...new Set(grants.data.scope.split(/[ ,]+/).filter(Boolean))];
    if (!scopes.every(s => /^[A-Za-z0-9_]+$/.test(s)) || !scopes.some(s => s === 'r_basicprofile' || s === 'r_liteprofile'))
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_GRANTS_UNKNOWN');
    const profile = await requestJson('https://api.linkedin.com/v2/me?projection=(id,vanityName)', { headers: headers(token) });
    const id = z.string().regex(/^[A-Za-z0-9_-]+$/).safeParse(profile.id);
    if (!id.success)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_GRANTS_UNKNOWN');
    const memberUrn = `urn:li:person:${id.data}`;
    if (expectedProfileSlug && profile.vanityName !== expectedProfileSlug)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_IDENTITY_MISMATCH');
    let organizationAuthorized = false;
    if (accountKind === 'personal' && authorUrn && authorUrn !== memberUrn)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_IDENTITY_MISMATCH');
    if (accountKind === 'organization') {
        if (!authorUrn || !/^urn:li:organization:[0-9]+$/.test(authorUrn) || !scopes.includes('rw_organization_admin'))
            throw new LinkedInOAuthError('LINKEDIN_OAUTH_ORGANIZATION_UNVERIFIED');
        const action = 'ORGANIC_SHARE_CREATE';
        const path = `(impersonator:${encodeURIComponent(memberUrn)},organization:${encodeURIComponent(authorUrn)},action:(organizationContentAuthorizationAction:(actionType:${action})))`;
        const permission = await requestJson(`https://api.linkedin.com/rest/organizationAuthorizations/${path}`, { headers: headers(token) });
        const status = object.safeParse(permission.status), actions = object.safeParse(permission.action);
        const actionDetail = actions.success ? object.safeParse(actions.data.OrganizationContentAuthorizationActionType) : null;
        organizationAuthorized = permission.impersonator === memberUrn && permission.organization === authorUrn && Boolean(status.success && Object.prototype.hasOwnProperty.call(status.data, 'com.linkedin.organization.Approved') && actionDetail?.success && actionDetail.data.actionType === action);
        if (!organizationAuthorized)
            throw new LinkedInOAuthError('LINKEDIN_OAUTH_ORGANIZATION_UNVERIFIED');
    }
    const author = accountKind === 'organization' ? authorUrn! : memberUrn;
    const postReadAuthorized = await verifyPostRead(token, author, scopes, accountKind === 'organization');
    // Documented permission eligibility only: no existing image is probed during consent. Same-attempt AVAILABLE/owner GET remains mandatory before a public POST.
    const imageReadAuthorized = scopes.includes('rw_ads') || scopes.includes('w_power_creators') || (scopes.includes('w_organization_social') && (accountKind !== 'organization' || organizationAuthorized));
    return { token, metadata: { memberUrn, authorUrn: accountKind === 'organization' ? authorUrn! : memberUrn, accountKind: accountKind === 'organization' ? 'organization' : 'personal', clientId: config.clientId, expiresAt: new Date(grants.data.expires_at * 1000).toISOString(), scopes, verifiedAt: new Date().toISOString(), organizationAuthorized, imageReadAuthorized, postReadAuthorized } };
}
