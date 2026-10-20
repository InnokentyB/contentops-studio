import { randomBytes } from 'crypto';
import prisma from '../db';
import { oauthRepository, oauthChannel, latestLinkedInConnectionAttempt } from './linkedin_oauth_repository';
import { oauthHash, configHash, LinkedInOAuthError, oauthConfiguration } from './linkedin_oauth_contract';
import { verifyOAuthCode } from './linkedin_oauth_provider';
export function oauthCookieName(state: string) { return `__Host-linkedin-${oauthHash(state).slice(0, 24)}`; }
export async function initiateLinkedInConnection(userId: number, projectId: number, channelId: number, expectedAuthorUrn?: string) {
    const config = oauthConfiguration();
    const channel = await oauthChannel(prisma, userId, projectId, channelId);
    const saved = channel.config as Record<string, unknown>;
    const storedUrn = typeof saved.linkedin_urn === 'string' ? saved.linkedin_urn : null;
    if (storedUrn && expectedAuthorUrn && storedUrn !== expectedAuthorUrn)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_IDENTITY_MISMATCH');
    const urn = storedUrn || expectedAuthorUrn || null;
    let profileSlug: string | null = null;
    for (const field of ['profile_url', 'channel_url', 'account_ref']) {
        if (typeof saved[field] !== 'string')
            continue;
        try {
            const url = new URL(saved[field]);
            if (url.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(url.hostname) || url.username || url.password || url.search || url.hash)
                continue;
            const match = url.pathname.match(/^\/in\/([A-Za-z0-9_-]+)\/?$/);
            if (match) {
                if (profileSlug && profileSlug !== match[1])
                    throw new LinkedInOAuthError('LINKEDIN_OAUTH_IDENTITY_MISMATCH');
                profileSlug = match[1];
            }
        }
        catch (error) {
            if (error instanceof LinkedInOAuthError)
                throw error;
        }
    }
    if (!urn && !profileSlug)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_EXPECTED_IDENTITY_REQUIRED');
    const kind = saved.account_type === 'organization' ? 'organization' : saved.account_type === 'personal' ? 'personal' : urn?.startsWith('urn:li:organization:') ? 'organization' : 'personal';
    if ((kind === 'personal' && urn?.startsWith('urn:li:organization:')) || (kind === 'organization' && urn?.startsWith('urn:li:person:')))
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_IDENTITY_MISMATCH');
    if (kind === 'organization' && (!urn || !/^urn:li:organization:[0-9]+$/.test(urn)))
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_CHANNEL_CHANGED');
    if (urn && !/^urn:li:(person:[A-Za-z0-9_-]+|organization:[0-9]+)$/.test(urn))
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_CHANNEL_CHANGED');
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    await oauthRepository.create({ provider: 'linkedin', purpose: 'channel_reconnect', state_hash: oauthHash(state), browser_hash: oauthHash(browser), client_id: config.clientId, user_id: userId, project_id: projectId, channel_id: channelId, account_kind: kind, expected_author_urn: urn, expected_profile_slug: profileSlug, channel_config_hash: configHash(channel.config), redirect_uri: config.redirectUri, expires_at: new Date(Date.now() + 600000) });
    const scopes = kind === 'organization' ? 'r_basicprofile w_organization_social r_organization_social rw_organization_admin' : `r_basicprofile w_member_social${process.env.LINKEDIN_PERSONAL_READBACK_REQUEST_ENABLED === 'true' ? ' r_member_social' : ''}`;
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, state, scope: scopes }).toString();
    return { url: url.toString(), state, browser };
}
export async function finishLinkedInConnection(input: {
    state: string;
    code?: string;
    error?: string;
}, browser: string | undefined) {
    const attempt = await oauthRepository.find(oauthHash(input.state));
    if (!attempt || attempt.provider !== 'linkedin' || attempt.purpose !== 'channel_reconnect' || attempt.expires_at.getTime() <= Date.now())
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_STATE_INVALID');
    if (!browser || !/^[A-Za-z0-9_-]{43}$/.test(browser) || oauthHash(browser) !== attempt.browser_hash)
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_BROWSER_MISMATCH');
    if (attempt.status !== 'pending')
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_ALREADY_USED');
    if ((attempt.redirect_uri !== oauthConfiguration().redirectUri || attempt.client_id !== oauthConfiguration().clientId))
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_CONFIG_REQUIRED');
    await oauthRepository.consume(attempt, new Date());
    try {
        if (input.error)
            throw new LinkedInOAuthError('LINKEDIN_OAUTH_PROVIDER_DENIED');
        if (!input.code)
            throw new LinkedInOAuthError('LINKEDIN_OAUTH_STATE_INVALID');
        const verified = await verifyOAuthCode(input.code, attempt.redirect_uri, attempt.expected_author_urn, attempt.account_kind, attempt.expected_profile_slug);
        await oauthRepository.complete(attempt, verified.token, verified.metadata);
        return { channelId: attempt.channel_id, projectId: attempt.project_id };
    }
    catch (error) {
        const code = error instanceof LinkedInOAuthError ? error.code : 'LINKEDIN_OAUTH_SAVE_FAILED';
        await oauthRepository.fail(attempt.id, code);
        throw new LinkedInOAuthError(code);
    }
}
/** Local persisted connection status only; no provider probe and no publication authority. */
export async function getLinkedInConnectionStatus(userId: number, projectId: number, channelId: number) {
    const channel = await oauthChannel(prisma, userId, projectId, channelId);
    const { resolveLinkedInCredentials } = await import('./linkedin_connection_credentials');
    let resolved;
    try {
        resolved = resolveLinkedInCredentials(channel.config, { projectId, channelId });
    } catch {
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_CONNECTION_UNREADABLE');
    }
    const expired = Boolean(resolved.metadata && new Date(resolved.metadata.expiresAt).getTime() <= Date.now());
    const missing = !resolved.token;
    const latestAttempt = await latestLinkedInConnectionAttempt(projectId, channelId);
    const postReadVerified = Boolean(resolved.verified && resolved.metadata?.postReadAuthorized);
    return {
        channelId,
        latestAttempt,
        connected: resolved.verified,
        expiresAt: resolved.metadata?.expiresAt || null,
        scopes: resolved.metadata?.scopes || [],
        accountKind: resolved.metadata?.accountKind || null,
        postReadVerified,
        imageReadVerified: false,
        imageReadPermitted: Boolean(resolved.verified && resolved.metadata?.imageReadAuthorized),
        code: !resolved.verified ? 'LINKEDIN_OAUTH_GRANTS_UNKNOWN' : !postReadVerified ? 'LINKEDIN_OAUTH_POST_READ_REQUIRED' : 'LINKEDIN_OAUTH_CONNECTED',
        reason: !resolved.verified ? (expired ? 'The stored LinkedIn token has expired.' : missing ? 'This channel has no stored LinkedIn access token.' : 'Stored credentials lack matching authenticated identity and actual grant metadata for this exact channel.') : !postReadVerified ? 'The connection exists, but supported post-read access for this author has not passed verification.' : 'Connection identity, actual grants and the author post-read endpoint were verified at consent; publication remains separately governed.',
        action: !resolved.verified ? 'Reconnect this exact channel and grant the supported profile and token introspection permissions.' : !postReadVerified ? 'Obtain the approved personal or organization post-read permission. Ask the administrator to enable approved personal readback permission requests if needed, then reconnect and repeat the read-only readiness check.' : 'Run the supported read-only readiness check before releasing an API publication. Image preparation must still verify the actual owned image before any public post.',
        publishingActivated: false
    };
}
