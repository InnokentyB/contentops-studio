import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import prisma from '../db';
import authService from '../services/auth.service';
import { ThreadsComplianceService } from '../services/threads_compliance.service';

type RouteOptions = FastifyPluginOptions & {
    service?: ThreadsComplianceService;
    hasProjectOwnerAccess?: (userId: number, projectId: number) => Promise<boolean>;
};

function readSignedRequest(body: unknown) {
    if (!body || typeof body !== 'object') return '';
    const value = (body as Record<string, unknown>).signed_request;
    return typeof value === 'string' ? value : '';
}

export default async function threadsComplianceRoutes(fastify: FastifyInstance, options: RouteOptions) {
    const service = options.service || new ThreadsComplianceService({
        db: prisma,
        appSecret: process.env.THREADS_APP_SECRET,
        stateSecret: process.env.THREADS_OAUTH_STATE_SECRET,
        publicAppUrl: process.env.PUBLIC_APP_URL || process.env.APP_URL
    });
    const hasProjectOwnerAccess = options.hasProjectOwnerAccess
        || ((userId: number, projectId: number) => authService.hasProjectAccess(userId, projectId, 'owner'));

    fastify.get('/api/integrations/threads/callback', async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        if (typeof query.code !== 'string' || typeof query.state !== 'string') {
            return reply.code(400).send({ error: 'Invalid Threads OAuth callback', code: 'THREADS_OAUTH_CALLBACK_INVALID' });
        }
        try {
            const state = service.readOAuthState(query.state);
            if (!await hasProjectOwnerAccess(state.userId, state.projectId)) {
                return reply.code(403).send({ error: 'Threads OAuth owner access is no longer valid', code: 'THREADS_OAUTH_OWNER_REQUIRED' });
            }
            if (!await service.findBoundChannel(state)) {
                return reply.code(404).send({ error: 'Threads channel no longer exists', code: 'THREADS_CHANNEL_NOT_FOUND' });
            }
            // Token persistence is deliberately fail-closed until encrypted Threads
            // credential storage and an idempotent exchange contract are available.
            return reply.code(501).send({
                error: 'Threads OAuth token exchange is not configured',
                code: 'THREADS_OAUTH_EXCHANGE_NOT_IMPLEMENTED'
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : '';
            const configurationError = message.endsWith('_REQUIRED');
            return reply.code(configurationError ? 503 : 400).send({
                error: configurationError ? 'Threads OAuth is not configured' : 'Invalid Threads OAuth state',
                code: configurationError ? 'THREADS_OAUTH_NOT_CONFIGURED' : 'THREADS_OAUTH_STATE_INVALID'
            });
        }
    });

    fastify.post('/api/integrations/threads/deauthorize', async (request, reply) => {
        try {
            await service.handleSignedRequest(readSignedRequest(request.body), 'deauthorize');
            return reply.code(200).send({ success: true });
        } catch (error: unknown) {
            const configurationError = error instanceof Error && error.message.endsWith('_REQUIRED');
            return reply.code(configurationError ? 503 : 400).send({
                error: configurationError ? 'Threads deauthorization is not configured' : 'Invalid signed request',
                code: configurationError ? 'THREADS_COMPLIANCE_NOT_CONFIGURED' : 'THREADS_SIGNED_REQUEST_INVALID'
            });
        }
    });

    fastify.post('/api/integrations/threads/data-deletion', async (request, reply) => {
        try {
            const result = await service.handleSignedRequest(readSignedRequest(request.body), 'data_delete');
            return reply.code(200).send({
                url: service.dataDeletionStatusUrl(result.confirmationCode),
                confirmation_code: result.confirmationCode
            });
        } catch (error: unknown) {
            const configurationError = error instanceof Error && error.message.endsWith('_REQUIRED');
            return reply.code(configurationError ? 503 : 400).send({
                error: configurationError ? 'Threads data deletion is not configured' : 'Invalid signed request',
                code: configurationError ? 'THREADS_COMPLIANCE_NOT_CONFIGURED' : 'THREADS_SIGNED_REQUEST_INVALID'
            });
        }
    });

    fastify.get('/api/integrations/threads/data-deletion/status', async (request, reply) => {
        const { code } = request.query as { code?: string };
        if (!code || !service.verifyConfirmationCode(code)) {
            return reply.code(404).send({ error: 'Deletion request not found', code: 'THREADS_DELETION_NOT_FOUND' });
        }
        return { status: 'completed', confirmation_code: code };
    });
}
