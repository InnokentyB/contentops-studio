import { FastifyInstance, FastifyRequest } from 'fastify';
import plannerService from '../services/planner.service';
import publisherService from '../services/publisher.service';
import telegramService from '../services/telegram.service';

/**
 * Verifies internal job invocation authorization.
 * If INTERNAL_JOB_SECRET is configured in environment, requests must supply
 * a matching secret via 'x-job-secret' header or Bearer authorization token.
 *
 * @param request Fastify request object
 * @returns boolean indicating whether the job request is authorized
 */
export function verifyJobAuthorization(request: FastifyRequest): boolean {
    const configuredSecret = process.env.INTERNAL_JOB_SECRET;
    if (!configuredSecret) {
        return true;
    }
    const headerSecret = request.headers['x-job-secret'];
    const authHeader = request.headers.authorization;
    const bearerSecret = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;
    return headerSecret === configuredSecret || bearerSecret === configuredSecret;
}

/**
 * Registers internal background job trigger endpoints with authentication protection.
 *
 * @param fastify FastifyInstance
 */
export default async function jobRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.addHook('preHandler', async (request, reply) => {
        if (!verifyJobAuthorization(request)) {
            reply.code(401).send({ error: 'Unauthorized: invalid or missing job secret' });
            return;
        }
    });

    fastify.post('/jobs/weekly-planning', async (request, reply) => {
        const ownerId = process.env.OWNER_CHAT_ID;
        if (!ownerId) return reply.status(500).send({ error: 'OWNER_CHAT_ID not set' });

        await telegramService.sendMessage(ownerId, 'Привет! Пора планировать контент на следующую неделю. Пришлите основную тему или направление.');

        return { success: true };
    });

    fastify.post('/jobs/publish-due', async (request, reply) => {
        const count = await publisherService.publishDuePosts();
        return { success: true, published_count: count };
    });
}

