"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyJobAuthorization = verifyJobAuthorization;
exports.default = jobRoutes;
const publisher_service_1 = __importDefault(require("../services/publisher.service"));
const telegram_service_1 = __importDefault(require("../services/telegram.service"));
/**
 * Verifies internal job invocation authorization.
 * If INTERNAL_JOB_SECRET is configured in environment, requests must supply
 * a matching secret via 'x-job-secret' header or Bearer authorization token.
 *
 * @param request Fastify request object
 * @returns boolean indicating whether the job request is authorized
 */
function verifyJobAuthorization(request) {
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
async function jobRoutes(fastify) {
    fastify.addHook('preHandler', async (request, reply) => {
        if (!verifyJobAuthorization(request)) {
            reply.code(401).send({ error: 'Unauthorized: invalid or missing job secret' });
            return;
        }
    });
    fastify.post('/jobs/weekly-planning', async (request, reply) => {
        const ownerId = process.env.OWNER_CHAT_ID;
        if (!ownerId)
            return reply.status(500).send({ error: 'OWNER_CHAT_ID not set' });
        await telegram_service_1.default.sendMessage(ownerId, 'Привет! Пора планировать контент на следующую неделю. Пришлите основную тему или направление.');
        return { success: true };
    });
    fastify.post('/jobs/publish-due', async (request, reply) => {
        const count = await publisher_service_1.default.publishDuePosts();
        return { success: true, published_count: count };
    });
}
