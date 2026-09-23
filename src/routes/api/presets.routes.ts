import { FastifyInstance } from 'fastify';
import prisma from '../../db';
import { safeEncryptProviderKey, safeDecryptProviderKey } from '../../utils/channel_secrets';

export default async function presetsRoutes(fastify: FastifyInstance) {
    fastify.get('/api/settings/presets', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        try {
            return await prisma.promptPreset.findMany({
                where: { project_id: projectId },
                orderBy: { created_at: 'desc' }
            });
        } catch (e: any) {
            console.error('Error in GET /api/settings/presets:', e);
            const fs = require('fs');
            fs.promises.appendFile('server_error.log', `[${new Date().toISOString()}] Error in GET /presets: ${e.message}\n${e.stack}\n\n`).catch(() => {});
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    fastify.post('/api/settings/presets', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { name, role, prompt_text } = request.body as { name?: string; role?: string; prompt_text?: string };
        if (!name || !role || !prompt_text) {
            return reply.code(400).send({ error: 'Name, role and prompt_text are required' });
        }

        return await prisma.promptPreset.create({
            data: { project_id: projectId, name, role, prompt_text }
        });
    });

    fastify.put('/api/settings/presets/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };
        const data = request.body as any;

        const count = await prisma.promptPreset.count({ where: { id: parseInt(id, 10), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        return await prisma.promptPreset.update({
            where: { id: parseInt(id, 10) },
            data
        });
    });

    fastify.delete('/api/settings/presets/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        const count = await prisma.promptPreset.count({ where: { id: parseInt(id, 10), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        await prisma.promptPreset.delete({ where: { id: parseInt(id, 10) } });
        return { success: true };
    });

    // Keys Management
    fastify.get('/api/settings/keys', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const keys = await prisma.providerKey.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: 'desc' }
        });

        // Mask keys
        return keys.map(k => {
            const rawKey = safeDecryptProviderKey(k.key);
            const masked = rawKey.length > 7
                ? rawKey.substring(0, 3) + '...' + rawKey.substring(rawKey.length - 4)
                : '***';
            return {
                ...k,
                key: masked
            };
        });
    });

    fastify.post('/api/settings/keys', async (request, reply) => {
        const projectId = (request as any).projectId;
        if (!projectId) return reply.code(400).send({ error: 'Project ID required' });

        const { name, key } = request.body as { name: string; key: string };
        if (!key) return reply.code(400).send({ error: 'Key is required' });

        let provider = 'Other';
        if (key.startsWith('sk-ant')) provider = 'Anthropic';
        else if (key.startsWith('AIza')) provider = 'Gemini';
        else if (key.startsWith('sk-')) provider = 'OpenAI';

        const newKey = await prisma.providerKey.create({
            data: {
                project_id: projectId,
                name: name || `${provider} Key`,
                key: safeEncryptProviderKey(key),
                provider
            }
        });

        return { success: true, id: newKey.id, provider: newKey.provider };
    });

    fastify.delete('/api/settings/keys/:id', async (request, reply) => {
        const projectId = (request as any).projectId;
        const { id } = request.params as { id: string };

        const count = await prisma.providerKey.count({ where: { id: parseInt(id, 10), project_id: projectId } });
        if (count === 0) return reply.code(404).send({ error: 'Not found' });

        await prisma.providerKey.delete({ where: { id: parseInt(id, 10) } });
        return { success: true };
    });
}
