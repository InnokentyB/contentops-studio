import { createHash } from 'crypto';
import { z } from 'zod';
export const oauthStartSchema = z.object({ projectId: z.coerce.number().int().positive(), channelId: z.coerce.number().int().positive(), expectedAuthorUrn: z.string().regex(/^urn:li:(person:[A-Za-z0-9_-]+|organization:[0-9]+)$/).optional() }).strict();
export const oauthCallbackSchema = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096).optional(), error: z.string().max(256).optional(), error_description: z.string().max(4096).optional() }).strict();
export const oauthHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const configHash = (value: unknown): string => oauthHash(JSON.stringify(canonical(value)));
function canonical(value: unknown): unknown { if (Array.isArray(value))
    return value.map(canonical); if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])); return value; }
const failures = {
    LINKEDIN_OAUTH_TOKEN_EXCHANGE_FAILED: ['LinkedIn token exchange did not return a supported response.', 'Check the app credentials and callback configuration. Inspect this consumed attempt before starting a fresh connection.'],
    LINKEDIN_OAUTH_TOKEN_RESPONSE_INVALID: ['LinkedIn token exchange returned no valid access token.', 'Ask engineering to inspect token exchange compatibility; no connection was saved.'],
    LINKEDIN_OAUTH_TOKEN_INTROSPECTION_FAILED: ['LinkedIn token introspection did not return a supported response.', 'Check application access to token introspection; no connection was saved.'],
    LINKEDIN_OAUTH_APP_CREDENTIALS_REJECTED: ['LinkedIn rejected application authentication during token introspection.', 'Verify the exact app client ID and secret privately in server configuration, then start a fresh connection.'],
    LINKEDIN_OAUTH_INTROSPECTION_INVALID: ['LinkedIn introspection did not include a valid active indicator.', 'Ask engineering to inspect introspection response compatibility; do not assume the token is active.'],
    LINKEDIN_OAUTH_TOKEN_INACTIVE: ['LinkedIn reports that the issued token is inactive.', 'Check whether access was revoked or the token belongs to another application, then reconnect.'],
    LINKEDIN_OAUTH_TOKEN_CLIENT_MISSING: ['Token introspection did not supply a verifiable application client ID.', 'The route requires authenticated application binding. Inspect introspection support before reconnecting.'],
    LINKEDIN_OAUTH_TOKEN_CLIENT_MISMATCH: ['The token belongs to a different application client.', 'Verify the approved application configuration and start a fresh connection with that application.'],
    LINKEDIN_OAUTH_TOKEN_EXPIRY_INVALID: ['Token introspection did not supply a supported expiry timestamp.', 'Inspect the provider expiry response; Planner cannot invent a token lifetime.'],
    LINKEDIN_OAUTH_TOKEN_EXPIRED: ['The issued LinkedIn token has already expired.', 'Start a fresh connection after checking application and clock configuration.'],
    LINKEDIN_OAUTH_TOKEN_SCOPES_MISSING: ['Token introspection did not supply the granted permissions.', 'Verify introspection support for the member authorization flow; do not infer grants from the consent request.'],
    LINKEDIN_OAUTH_TOKEN_SCOPES_INVALID: ['Token introspection returned unsupported permission metadata.', 'Ask engineering to inspect the permission response format; no connection was saved.'],
    LINKEDIN_OAUTH_PROFILE_SCOPE_REQUIRED: ['The issued token lacks the supported profile permission required to verify identity.', 'Enable an approved r_basicprofile or r_liteprofile permission for this app, then reconnect.'],
    LINKEDIN_OAUTH_PROFILE_REQUEST_FAILED: ['LinkedIn profile verification did not return a supported response.', 'Check that the app and issued token can access the supported member profile endpoint.'],
    LINKEDIN_OAUTH_PROFILE_ID_INVALID: ['LinkedIn profile verification returned no supported member ID.', 'Inspect profile API compatibility; do not substitute an unverified person or organization identity.'],
    LINKEDIN_OAUTH_ORGANIZATION_REQUEST_FAILED: ['LinkedIn organization authorization verification did not return a supported response.', 'Check organization authorization API access and the page administrator role.'],
    LINKEDIN_CHANNEL_REQUIRED: ['Select an existing LinkedIn channel.', 'Choose the exact personal or organization channel in Settings and reconnect.'],
    LINKEDIN_OAUTH_AUTH_REQUIRED: ['A current non-demo project Owner must initiate this connection.', 'Sign in as the project Owner and reconnect the selected channel.'],
    LINKEDIN_OAUTH_CHANNEL_CHANGED: ['The selected channel changed while connection was in progress.', 'Check its identity and start a fresh connection for that channel.'],
    LINKEDIN_OAUTH_STATE_INVALID: ['This connection request is invalid or expired.', 'Start a fresh connection from Settings; do not reuse the callback URL.'],
    LINKEDIN_OAUTH_BROWSER_MISMATCH: ['This browser does not match the connection request.', 'Reconnect from the same browser and allow the secure connection cookie.'],
    LINKEDIN_OAUTH_ALREADY_USED: ['This connection request has already been consumed.', 'Check channel status; if incomplete, start a fresh connection. Do not replay this callback.'],
    LINKEDIN_OAUTH_CONFIG_REQUIRED: ['The LinkedIn application or secure callback configuration is incomplete.', 'Ask the administrator to configure the approved client, matching HTTPS API/frontend origin and channel encryption key.'],
    LINKEDIN_OAUTH_PROVIDER_DENIED: ['LinkedIn consent was declined.', 'Start a fresh connection and grant the permissions approved for this channel.'],
    LINKEDIN_OAUTH_PROVIDER_UNAVAILABLE: ['LinkedIn did not return a supported connection response.', 'Check application permissions and provider availability, then start a fresh connection.'],
    LINKEDIN_OAUTH_CONNECTION_UNREADABLE: ['The stored connection could not be authenticated or decoded.', 'Ask the administrator to verify the channel encryption key and stored connection, then reconnect this exact channel.'],
    LINKEDIN_OAUTH_GRANTS_UNKNOWN: ['The issued token identity, expiry or actual grants could not be verified.', 'Enable the supported profile and token introspection permissions, then reconnect.'],
    LINKEDIN_OAUTH_EXPECTED_IDENTITY_REQUIRED: ['The selected channel has no verifiable expected LinkedIn identity.', 'Enter the intended public person/organization URN, or configure the exact personal profile URL, then reconnect this existing channel.'],
    LINKEDIN_OAUTH_IDENTITY_MISMATCH: ['LinkedIn returned a different member from the selected channel identity.', 'Sign in to the intended LinkedIn member; do not replace the channel to bypass this check.'],
    LINKEDIN_OAUTH_ORGANIZATION_UNVERIFIED: ['Authority to create posts for this exact organization was not verified.', 'Grant supported organization authorization access and the required organization role, then reconnect.'],
    LINKEDIN_OAUTH_SAVE_FAILED: ['The verified connection could not be saved atomically.', 'Check channel status and start a fresh connection if incomplete; the consumed callback cannot be retried.']
} as const;
export type OAuthFailureCode = keyof typeof failures;
export function isOAuthFailureCode(value: unknown): value is OAuthFailureCode { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(failures, value); }
export class LinkedInOAuthError extends Error {
    constructor(readonly code: OAuthFailureCode) { super(failures[code][0]); }
}
export function oauthDiagnostic(error: unknown) { const code = error instanceof LinkedInOAuthError ? error.code : 'LINKEDIN_OAUTH_SAVE_FAILED'; return { code, error: failures[code][0], action: failures[code][1] }; }
export function oauthConfiguration() { try {
    const api = new URL(process.env.API_URL || ''), frontend = new URL(process.env.FRONTEND_URL || '');
    if (api.origin !== frontend.origin || api.protocol !== 'https:' || frontend.protocol !== 'https:' || api.username || api.password || frontend.username || frontend.password || api.pathname !== '/' || frontend.pathname !== '/' || api.search || api.hash || frontend.search || frontend.hash || !process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET || (process.env.CHANNEL_SECRETS_KEY?.trim().length || 0) < 32)
        throw Error();
    return { redirectUri: `${api.origin}/api/auth/linkedin/callback`, frontend: frontend.origin, clientId: process.env.LINKEDIN_CLIENT_ID, clientSecret: process.env.LINKEDIN_CLIENT_SECRET };
}
catch {
    throw new LinkedInOAuthError('LINKEDIN_OAUTH_CONFIG_REQUIRED');
} }
