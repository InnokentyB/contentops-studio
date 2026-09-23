import { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import publisherService from '../services/publisher.service';
import telegramService from '../services/telegram.service';

/**
 * Verifies internal job invocation authorization.
 * Fails closed if INTERNAL_JOB_SECRET is not configured, unless explicitly bypassed
 * in development via ALLOW_INSECURE_JOBS=true.
 * Employs timingSafeEqual comparison to defend against timing side-channel attacks.
 *
 * @param request Fastify request object
 * @returns boolean indicating whether the job request is authorized
 */
export function verifyJobAuthorization(request: FastifyRequest): boolean {
    const configuredSecret = process.env.INTERNAL_JOB_SECRET;
    if (!configuredSecret) {
        if (process.env.NODE_ENV === 'development' && process.env.ALLOW_INSECURE_JOBS === 'true') {
            return true;
        }
        return false;
    }

    const headerSecret = request.headers['x-job-secret'];
    const authHeader = request.headers.authorization;
    const bearerSecret = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    const provided = (typeof headerSecret === 'string' ? headerSecret : null) || bearerSecret;
    if (!provided) {
        return false;
    }

    try {
        const providedBuf = Buffer.from(provided);
        const configuredBuf = Buffer.from(configuredSecret);
        if (providedBuf.length !== configuredBuf.length) {
            return false;
        }
        return crypto.timingSafeEqual(providedBuf, configuredBuf);
    } catch {
        return false;
    }
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
