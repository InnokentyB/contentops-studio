import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../../db';
import publisherService from '../../services/publisher.service';
import storageService from '../../services/storage.service';
import contentDictionaryService from '../../services/content_dictionary.service';
import { getAuthorizedPost } from './helpers';
import { UpdatePostSchema, ApprovePostSchema } from '../../schemas/routes.schema';

interface IdParams {
    id: string;
}

interface GenerateImageBody {
    provider?: 'preview' | 'final' | 'flagship' | 'gpt-image' | 'nano' | 'full';
}

interface GeneratePostBody {
    promptPresetId?: number;
    withImage?: boolean;
}

interface ValidateDictionaryBody {
    text?: string;
}

export default async function postsRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.post('/api/posts/:id/generate-image', async (request: FastifyRequest<{ Params: IdParams; Body: GenerateImageBody }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'editor');

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const projectId = post.project_id;
        const { provider } = request.body || {};

        try {
            console.log(`[Generate Image] Enqueueing request for Post ${id}, Mode: ${provider || 'preview'}`);
            const textToUse = post.final_text || post.generated_text || post.topic || '';

            await prisma.post.update({
                where: { id: parseInt(id, 10) },
                data: { status: 'generating' }
            });

            const { imageQueue } = require('../../queue');
            await imageQueue.add('generate-image', {
                projectId,
                postId: post.id,
                provider: provider || 'preview',
                textToUse,
                topic: post.topic
            }, {
                attempts: 2,
                backoff: { type: 'exponential', delay: 10000 }
            });

            return reply.code(202).send({ success: true, message: 'Image generation queued' });
        } catch (error: unknown) {
            const err = error as Error;
            request.log.error(err);
            return reply.code(500).send({ error: `Queue failed: ${err.message}` });
        }
    });

    fastify.post('/api/posts/:id/upload-image', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'editor');

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const fileGetter = request as unknown as { file: () => Promise<{ toBuffer: () => Promise<Buffer>; filename: string; mimetype: string } | undefined> };
        const data = await fileGetter.file();

        if (!data) {
            return reply.code(400).send({ error: 'No file uploaded' });
        }

        try {
            const buffer = await data.toBuffer();
            const ext = data.filename.split('.').pop() || 'jpg';
            const filename = `post-${id}-${Date.now()}.${ext}`;
            const destinationPath = `uploads/${filename}`;

            console.log(`[Upload] Uploading ${filename} to Supabase Storage...`);
            const imageUrl = await storageService.uploadFileFromBuffer(buffer, data.mimetype, destinationPath);
            console.log(`[Upload] Upload success: ${imageUrl}`);

            await prisma.post.update({
                where: { id: parseInt(id, 10) },
                data: {
                    image_url: imageUrl,
                    image_prompt: 'Uploaded by user'
                }
            });

            return { success: true, imageUrl };
        } catch (error: unknown) {
            const err = error as Error;
            request.log.error(err);
            return reply.code(500).send({ error: 'Upload failed', details: err.message || String(error) });
        }
    });

    fastify.get('/api/posts/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'viewer', true);

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        let weekPackageId = null;
        if (post.week) {
            const weekPackage = await prisma.weekPackage.findFirst({
                where: {
                    project_id: post.project_id,
                    week_start: {
                        gte: post.week.week_start,
                        lte: post.week.week_end
                    }
                }
            });
            weekPackageId = weekPackage?.id || null;
        }

        const { week, ...rest } = post as { week?: unknown; [key: string]: unknown };
        return {
            ...rest,
            week_package_id: weekPackageId
        };
    });

    fastify.put('/api/posts/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'editor');

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const parseResult = UpdatePostSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.code(400).send({ error: parseResult.error.message });
        }
        const data = parseResult.data;

        const updatedPost = await prisma.post.update({
            where: { id: parseInt(id, 10) },
            data: data as Prisma.PostUpdateInput
        });

        return updatedPost;
    });

    fastify.post('/api/posts/:id/approve', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'editor');

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const parseResult = ApprovePostSchema.safeParse(request.body || {});
        if (!parseResult.success) {
            return reply.code(400).send({ error: parseResult.error.message });
        }
        const data = parseResult.data;

        const updatedPost = await prisma.post.update({
            where: { id: parseInt(id, 10) },
            data: {
                ...data,
                status: 'scheduled'
            } as Prisma.PostUpdateInput
        });

        return updatedPost;
    });

    fastify.post('/api/posts/:id/approve-topic', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'editor');

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const updatedPost = await prisma.post.update({
            where: { id: parseInt(id, 10) },
            data: { status: 'topics_approved' }
        });
        return updatedPost;
    });

    fastify.post('/api/posts/:id/publish-now', async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'editor');

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        try {
            const host = request.headers.host || undefined;
            const result = await publisherService.publishPostNow(parseInt(id, 10), host);
            return {
                success: true,
                publishMethod: result.publishMethod,
                warning: result.warning || null
            };
        } catch (e: unknown) {
            const err = e as Error;
            console.error('Publish now failed', err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/posts/:id/generate', async (request: FastifyRequest<{ Params: IdParams; Body: GeneratePostBody }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'editor', true);

        if (!post || !post.week) {
            return reply.code(404).send({ error: 'Post not found or access denied' });
        }

        const projectId = post.project_id;

        if (!post.topic) {
            return reply.code(400).send({ error: 'Post has no topic' });
        }

        const { promptPresetId, withImage } = request.body || {};
        let promptOverride: string | undefined;
        if (promptPresetId) {
            const preset = await prisma.promptPreset.findUnique({ where: { id: promptPresetId } });
            if (preset) promptOverride = preset.prompt_text;
        }

        await prisma.post.update({
            where: { id: post.id },
            data: { status: 'generating' }
        });

        const { postsQueue } = require('../../queue');
        await postsQueue.add('generate-post', {
            projectId,
            theme: post.week.theme,
            topic: post.topic,
            postId: post.id,
            promptOverride,
            withImage,
            isBatch: false
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 }
        });

        return reply.code(202).send({ success: true, message: 'Generation queued in background' });
    });

    fastify.post('/api/posts/:id/validate-dictionary', async (request: FastifyRequest<{ Params: IdParams; Body: ValidateDictionaryBody }>, reply: FastifyReply) => {
        const { id } = request.params;
        const user = (request as unknown as { user?: { id: number } }).user;
        const post = await getAuthorizedPost(parseInt(id, 10), user?.id ?? 0, 'viewer');

        if (!post) {
            return reply.code(404).send({ error: 'Post not found' });
        }

        const projectId = post.project_id;
        const { text } = request.body || {};

        const dictionarySetting = await prisma.projectSettings.findUnique({
            where: { project_id_key: { project_id: projectId, key: 'content_dictionary_yaml' } }
        });

        const report = contentDictionaryService.validateText(
            text || post.final_text || post.generated_text || '',
            dictionarySetting?.value || null
        );

        return report;
    });
}
