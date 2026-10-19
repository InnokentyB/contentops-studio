import { FastifyInstance } from 'fastify';
import authService from '../services/auth.service';
import { oauthStartSchema, oauthCallbackSchema, oauthDiagnostic, oauthConfiguration, LinkedInOAuthError } from '../services/linkedin_oauth_contract';
import { initiateLinkedInConnection, finishLinkedInConnection, oauthCookieName, getLinkedInConnectionStatus } from '../services/linkedin_oauth.service';
function authenticatedUserId(authorization: string | undefined): number {
    if (!authorization?.startsWith('Bearer ')) throw new LinkedInOAuthError('LINKEDIN_OAUTH_AUTH_REQUIRED');
    try {
        const user = authService.verifyToken(authorization.slice(7));
        if (user.is_demo) throw new LinkedInOAuthError('LINKEDIN_OAUTH_AUTH_REQUIRED');
        return user.id;
    } catch {
        throw new LinkedInOAuthError('LINKEDIN_OAUTH_AUTH_REQUIRED');
    }
}
/** Existing OAuth surface; explicit tenant channel, no publication or incidental channel creation. */
export default async function linkedinRoutes(fastify: FastifyInstance) {
    fastify.addHook('onRequest', async (request, reply) => { if (request.url.startsWith('/api/auth/linkedin/'))
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer'); });
    fastify.get('/api/auth/linkedin/connect', async (request, reply) => { const parsed = oauthStartSchema.safeParse(request.query); if (!parsed.success)
        return reply.code(400).send(oauthDiagnostic(new LinkedInOAuthError('LINKEDIN_CHANNEL_REQUIRED'))); try {
        const userId = authenticatedUserId(request.headers.authorization);
        const started = await initiateLinkedInConnection(userId, parsed.data.projectId, parsed.data.channelId, parsed.data.expectedAuthorUrn);
        reply.header('Set-Cookie', `${oauthCookieName(started.state)}=${started.browser}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`);
        return { url: started.url };
    }
    catch (error) {
        const diagnostic = oauthDiagnostic(error);
        return reply.code(diagnostic.code === 'LINKEDIN_OAUTH_AUTH_REQUIRED' ? 403 : 400).send(diagnostic);
    } });
    fastify.get('/api/auth/linkedin/status', async (request, reply) => { const parsed = oauthStartSchema.safeParse(request.query); if (!parsed.success)
        return reply.code(400).send(oauthDiagnostic(new LinkedInOAuthError('LINKEDIN_CHANNEL_REQUIRED'))); try {
        const userId = authenticatedUserId(request.headers.authorization);
        return await getLinkedInConnectionStatus(userId, parsed.data.projectId, parsed.data.channelId);
    }
    catch (error) {
        return reply.code(403).send(oauthDiagnostic(error));
    } });
    fastify.get('/api/auth/linkedin/callback', async (request, reply) => { const parsed = oauthCallbackSchema.safeParse(request.query); if (!parsed.success)
        return reply.code(400).send(oauthDiagnostic(new LinkedInOAuthError('LINKEDIN_OAUTH_STATE_INVALID'))); const name = oauthCookieName(parsed.data.state); const cookies = (request.headers.cookie || '').split(';').map(part => part.trim().split('=')); const matching = cookies.filter(([key]) => key === name); const browser = matching.length === 1 ? matching[0]?.[1] : undefined; reply.header('Set-Cookie', `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`); try {
        const connected = await finishLinkedInConnection(parsed.data, browser);
        return reply.redirect(`${oauthConfiguration().frontend}/settings?tab=channels&linkedin=connected&channelId=${connected.channelId}&projectId=${connected.projectId}`);
    }
    catch (error) {
        const diagnostic = oauthDiagnostic(error);
        let frontend: string;
        try {
            frontend = oauthConfiguration().frontend;
        }
        catch {
            return reply.code(503).send(diagnostic);
        }
        return reply.redirect(`${frontend}/settings?tab=channels&error=${diagnostic.code}`);
    } });
}
