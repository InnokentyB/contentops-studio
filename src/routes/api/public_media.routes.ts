import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../../db';
import fs from 'fs';
import path from 'path';
import { safeResolveUploadPath } from '../../utils/path_safety';

interface IdParams {
    id: string;
}

export default async function publicMediaRoutes(fastify: FastifyInstance): Promise<void> {
    // Public endpoint to serve images for Telegram link preview
    fastify.get('/public/posts/:id/image', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const post = await prisma.post.findUnique({
            where: { id: parseInt(id) },
            select: { image_url: true }
        });

        if (!post || !post.image_url) {
            return reply.code(404).send({ error: 'Image not found' });
        }

        if (post.image_url.startsWith('data:image/')) {
            const matches = post.image_url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return reply.code(400).send({ error: 'Invalid image format' });
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            reply.header('Content-Type', mimeType);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(buffer);
        } else if (post.image_url.startsWith('/uploads/')) {
            const localPath = safeResolveUploadPath(post.image_url);
            if (localPath && fs.existsSync(localPath)) {
                const ext = path.extname(localPath).slice(1).toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                const buffer = fs.readFileSync(localPath);
                reply.header('Content-Type', mimeType);
                reply.header('Cache-Control', 'public, max-age=86400');
                return reply.send(buffer);
            }
            return reply.code(404).send({ error: 'Local image file not found' });
        } else if (post.image_url.startsWith('http')) {
            return reply.redirect(post.image_url);
        } else {
            return reply.code(400).send({ error: 'Unrecognized image url format' });
        }
    });

    // Public endpoint to serve images for V2 ContentItem link preview
    fastify.get('/public/content-items/:id/image', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const item = await prisma.contentItem.findUnique({
            where: { id: parseInt(id) },
            select: { assets: true }
        });

        if (!item || !item.assets) {
            return reply.code(404).send({ error: 'ContentItem or assets not found' });
        }

        const assets = item.assets as { generated_visuals?: Array<{ url?: string; image_url?: string; src?: string }> } | null;
        const generatedVisual = Array.isArray(assets?.generated_visuals)
            ? assets.generated_visuals[0]
            : null;
        const imageUrl = generatedVisual?.url || generatedVisual?.image_url || generatedVisual?.src || null;

        if (!imageUrl) {
            return reply.code(404).send({ error: 'Image not found in assets' });
        }

        if (imageUrl.startsWith('data:image/')) {
            const matches = imageUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return reply.code(400).send({ error: 'Invalid image format' });
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            reply.header('Content-Type', mimeType);
            reply.header('Cache-Control', 'public, max-age=86400');
            return reply.send(buffer);
        } else if (imageUrl.startsWith('/uploads/')) {
            const localPath = safeResolveUploadPath(imageUrl);
            if (localPath && fs.existsSync(localPath)) {
                const ext = path.extname(localPath).slice(1).toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                const buffer = fs.readFileSync(localPath);
                reply.header('Content-Type', mimeType);
                reply.header('Cache-Control', 'public, max-age=86400');
                return reply.send(buffer);
            }
            return reply.code(404).send({ error: 'Local image file not found' });
        } else if (imageUrl.startsWith('http')) {
            return reply.redirect(imageUrl);
        } else {
            return reply.code(400).send({ error: 'Unrecognized image url format' });
        }
    });
}
