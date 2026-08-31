import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import OpenAI from 'openai';
import { config } from 'dotenv';
import { POST_SYSTEM_PROMPT } from '../config/prompts';
import multiAgentService from './multi_agent.service';
import { estimateImageCostUsd, modelForRole } from './model_policy.service';
import { channelContentLanguage, contentLanguageInstruction } from './content_language.service';

config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_GOOGLE_IMAGE_MODEL = 'gemini-3.1-flash-image';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';
const RETIRED_GOOGLE_IMAGE_MODELS = new Set([
    'imagen-3.0-generate-002',
    'imagen-4.0-generate-001'
]);

function resolveGoogleImageModel(explicitModel?: string) {
    const configured = (explicitModel || process.env.GOOGLE_IMAGE_MODEL || '').trim().replace(/^models\//, '');
    if (!configured || RETIRED_GOOGLE_IMAGE_MODELS.has(configured)) {
        return DEFAULT_GOOGLE_IMAGE_MODEL;
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(configured)) {
        throw new Error('GOOGLE_IMAGE_MODEL has an invalid format');
    }
    return configured;
}

class GeneratorService {
    private openai!: OpenAI;
    private genAI: any;

    private PROMPT_KEY_GPT_IMAGE = 'image_generation_prompt';
    private PROMPT_KEY_NANO = 'nano_banana_image_prompt';

    private DEFAULT_PROMPT_GPT_IMAGE = "Create a modern, flat vector illustration for a tech blog post about: ${topic}. \n\nStyle: Minimalist, clean lines, corporate colors (blue, grey, white). \nUse metaphors related to: ${text.substring(0, 500)} \nNo text in the image.";
    private DEFAULT_PROMPT_NANO = "Generate a photorealistic image for a post about ${topic}. Context: ${text.substring(0, 500)}. High quality, professional lighting.";

    constructor() {
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
        }

        if (process.env.GOOGLE_API_KEY) {
            try {
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
            } catch (e) {
                console.error('Failed to initialize Google AI', e);
            }
        }
    }

    private async logImageInvocation(input: {
        projectId?: number;
        status: 'success' | 'failed';
        provider: string;
        model: string;
        prompt: string;
        output?: string;
        error?: string;
        latencyMs: number;
        inputTokens?: number;
        outputTokens?: number;
        providerRequestId?: string;
        metadata?: Record<string, unknown>;
    }) {
        if (!input.projectId) return;
        try {
            await prisma.agentRun.create({
                data: {
                    project: { connect: { id: input.projectId } },
                    type: 'model_invocation',
                    agent_role: 'image_generator',
                    status: input.status,
                    input: input.prompt.slice(0, 5000),
                    output: input.output?.slice(0, 5000),
                    error: input.error?.slice(0, 5000),
                    provider: input.provider,
                    model: input.model,
                    input_tokens: input.inputTokens,
                    output_tokens: input.outputTokens,
                    estimated_cost_usd: estimateImageCostUsd(input.model) ?? undefined,
                    latency_ms: input.latencyMs,
                    provider_request_id: input.providerRequestId,
                    invocation_metadata: input.metadata as any
                }
            });
        } catch (error) {
            console.error('Failed to log image invocation', error);
        }
    }

    async getImagePromptTemplate(projectId: number, provider: 'gpt-image' | 'nano' = 'gpt-image'): Promise<string> {
        const key = provider === 'nano' ? this.PROMPT_KEY_NANO : this.PROMPT_KEY_GPT_IMAGE;
        const defaultPrompt = provider === 'nano' ? this.DEFAULT_PROMPT_NANO : this.DEFAULT_PROMPT_GPT_IMAGE;

        try {
            const setting = await prisma.projectSettings.findUnique({
                where: {
                    project_id_key: {
                        project_id: projectId,
                        key: key
                    }
                }
            });

            if (setting) return setting.value;

            // If not set, initialize with default (safely)
            try {
                await prisma.projectSettings.create({
                    data: {
                        project_id: projectId,
                        key: key,
                        value: defaultPrompt
                    }
                });
            } catch (e) {
                // Ignore race condition if another process already created it
            }

            return defaultPrompt;
        } catch (e) {
            console.error(`Error fetching image prompt template for ${provider}`, e);
            return defaultPrompt;
        }
    }

    async updateImagePromptTemplate(projectId: number, value: string, provider: 'gpt-image' | 'nano' = 'gpt-image') {
        const key = provider === 'nano' ? this.PROMPT_KEY_NANO : this.PROMPT_KEY_GPT_IMAGE;

        await prisma.projectSettings.upsert({
            where: {
                project_id_key: {
                    project_id: projectId,
                    key: key
                }
            },
            update: { value },
            create: { project_id: projectId, key: key, value }
        });
    }

    async generateTopics(projectId: number, theme: string, weekId: number, promptOverride?: string, count: number = 5, existingTopics: string[] = []): Promise<{ topics: { topic: string, category: string, tags: string[] }[], score: number }> {
        // Week plans inherit language from their target channel's existing slots.
        const slot = await prisma.post.findFirst({
            where: { project_id: projectId, week_id: weekId },
            orderBy: { slot_index: 'asc' },
            include: { channel: true }
        });
        const contentLanguage = channelContentLanguage(slot?.channel);

        return await multiAgentService.refineTopics(
            projectId,
            theme,
            weekId,
            promptOverride,
            count,
            existingTopics,
            contentLanguage
        );
    }

    async generatePostText(projectId: number, theme: string, topic: string, postId: number, promptOverride?: string, withImage: boolean = false) {
        const post = postId > 0
            ? await prisma.post.findFirst({
                where: { id: postId, project_id: projectId },
                include: { channel: true }
            })
            : null;
        const contentLanguage = channelContentLanguage(post?.channel);
        const result = await multiAgentService.runPostGeneration(projectId, theme, topic, postId, promptOverride, withImage, contentLanguage);
        return {
            text: result.finalText,
            category: result.category,
            tags: result.tags
        };
    }

    async generateContentItemText(contentItemId: number) {
        const item = await prisma.contentItem.findUnique({
            where: { id: contentItemId },
            include: { week_package: true, channel: true }
        });

        if (!item || !item.week_package) throw new Error("ContentItem or WeekPackage not found");

        const theme = item.week_package.week_theme || '';
        const topic = item.title || item.brief || 'Unknown topic';
        const contentLanguage = channelContentLanguage(item.channel);

        // For MVP, reuse the existing runPostGeneration logic but point it to this ContentItem's topic
        // A more advanced integration would pass the ContentItem's specific requirements (layer, CTA) 
        // to a dedicated v2 prompt.
        const promptOverride = `You are a content writer. Weekly theme: ${theme}. Core thesis: ${item.week_package.core_thesis}.
Write a publication draft:
Format: ${item.type} (layer: ${item.layer || 'general'})
Title: ${item.title}
Details: ${item.brief}
Key points: ${(item.key_points as string[] || []).join(', ')}
CTA: ${item.cta || 'None'}

${contentLanguageInstruction(contentLanguage)}
Return the publication text only, without meta-commentary.`;

        // Mocking postId as 0 since we capture the output directly and will save it to ContentItem manually
        const result = await multiAgentService.runPostGeneration(item.project_id, theme, topic, 0, promptOverride, false, contentLanguage);

        await prisma.contentItem.update({
            where: { id: item.id },
            data: { draft_text: result.finalText, status: 'drafted', quality_report: result.history as any }
        });

        return result.finalText;
    }

    async generateImagePrompt(projectId: number, topic: string, text: string, provider: 'gpt-image' | 'nano' = 'gpt-image'): Promise<string> {
        let template = await this.getImagePromptTemplate(projectId, provider);

        // Replace placeholders safely
        const filledPrompt = template
            .replace('${topic}', topic)
            .replace('${text.substring(0, 500)}', text.substring(0, 500));

        const response = await this.openai.chat.completions.create({
            model: modelForRole('precision_fixer'),
            messages: [{ role: 'user', content: filledPrompt }], // Simplification: just use the template as the prompt
        });

        const generatedPrompt = response.choices[0].message.content || '';

        return generatedPrompt;
    }

    async generateImage(prompt: string, projectId?: number): Promise<string> {
        const startedAt = Date.now();
        const model = (process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL).trim();
        try {
            const response: any = await this.openai.images.generate({
                model,
                prompt: prompt,
                n: 1,
                size: "1024x1024",
            });

            if (!response.data || !response.data[0]) {
                throw new Error('No image data returned from GPT-Image');
            }

            const item = response.data[0];
            let buffer: Buffer;

            if (item.b64_json) {
                buffer = Buffer.from(item.b64_json, 'base64');
            } else if (item.url) {
                const downloadRes = await fetch(item.url);
                if (!downloadRes.ok) throw new Error(`Failed to download image from URL: ${downloadRes.statusText}`);
                const arrayBuffer = await downloadRes.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
            } else {
                throw new Error('No url or b64_json returned in GPT-Image response');
            }

            // Upload buffer directly to storage
            const filename = `img-${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
            const storageService = require('./storage.service').default;
            const url = await storageService.uploadFileFromBuffer(buffer, 'image/png', `generated/${filename}`);
            await this.logImageInvocation({
                projectId, status: 'success', provider: 'openai', model, prompt, output: url,
                latencyMs: Date.now() - startedAt,
                inputTokens: response.usage?.input_tokens,
                outputTokens: response.usage?.output_tokens,
                providerRequestId: response.id,
                metadata: { size: '1024x1024', quality: 'default' }
            });
            return url;
        } catch (e: any) {
            console.error('Failed to generate image (GPT-Image)', e);
            await this.logImageInvocation({ projectId, status: 'failed', provider: 'openai', model, prompt, error: e?.message || String(e), latencyMs: Date.now() - startedAt });
            throw e;
        }
    }

    private async downloadAndSaveImage(url: string, filename: string): Promise<string> {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const storageService = require('./storage.service').default;
            return await storageService.uploadFileFromBuffer(buffer, 'image/png', `generated/${filename}`);
        } catch (e: any) {
            console.error('Failed to upload generated image to storage', e);
            throw e;
        }
    }

    async generateImageNanoBanana(prompt: string, referenceImageBase64?: string, requestedModel?: string, projectId?: number): Promise<string> {
        if (!process.env.GOOGLE_API_KEY) {
            throw new Error('GOOGLE_API_KEY is not set');
        }

        const startedAt = Date.now();
        let model = '';
        try {
            model = resolveGoogleImageModel(requestedModel);
            const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;
            const referenceMatch = referenceImageBase64?.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);

            const promptParts: any[] = [{ text: prompt }];
            if (referenceMatch) {
                promptParts.push({
                    inline_data: {
                        mime_type: referenceMatch[1],
                        data: referenceMatch[2]
                    }
                });
            }

            const sendRequest = async (parts: any[]) => {
                return await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': process.env.GOOGLE_API_KEY as string
                    },
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: {
                            responseModalities: ['IMAGE']
                        }
                    })
                });
            };

            let response = await sendRequest(promptParts);

            if (!response.ok && referenceMatch) {
                const errorText = await response.text();
                console.warn(`[Nano Banana] Reference image rejected, falling back to prompt only. Error: ${errorText}`);
                response = await sendRequest([{ text: prompt }]);
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Google API Error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data: any = await response.json();
            const parts = data?.candidates?.[0]?.content?.parts;
            const imagePart = Array.isArray(parts)
                ? parts.find((part: any) => part?.inlineData?.data || part?.inline_data?.data)
                : null;
            const inlineData = imagePart?.inlineData || imagePart?.inline_data;

            if (!inlineData?.data) {
                console.error("Unexpected Google API Query Response", JSON.stringify(data));
                throw new Error('No image data returned from Google Gemini Image');
            }

            const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
            const resultUrl = `data:${mimeType};base64,${inlineData.data}`;
            await this.logImageInvocation({
                projectId, status: 'success', provider: 'google', model, prompt, output: '[inline image]',
                latencyMs: Date.now() - startedAt,
                inputTokens: data.usageMetadata?.promptTokenCount,
                outputTokens: data.usageMetadata?.candidatesTokenCount,
                providerRequestId: data.responseId,
                metadata: { referenceImage: Boolean(referenceMatch), resolution: '1K' }
            });
            return resultUrl;

        } catch (e: any) {
            console.error('Failed to generate image (Nano Banana)', e);
            await this.logImageInvocation({ projectId, status: 'failed', provider: 'google', model: model || requestedModel || DEFAULT_GOOGLE_IMAGE_MODEL, prompt, error: e?.message || String(e), latencyMs: Date.now() - startedAt });
            throw e;
        }
    }
}

export default new GeneratorService();
