"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const openai_1 = __importDefault(require("openai"));
const dotenv_1 = require("dotenv");
const multi_agent_service_1 = __importDefault(require("./multi_agent.service"));
const model_policy_service_1 = require("./model_policy.service");
(0, dotenv_1.config)();
const connectionString = process.env.DATABASE_URL;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
const DEFAULT_GOOGLE_IMAGE_MODEL = 'gemini-3.1-flash-image';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';
const RETIRED_GOOGLE_IMAGE_MODELS = new Set([
    'imagen-3.0-generate-002',
    'imagen-4.0-generate-001'
]);
function resolveGoogleImageModel(explicitModel) {
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
    constructor() {
        this.PROMPT_KEY_GPT_IMAGE = 'image_generation_prompt';
        this.PROMPT_KEY_NANO = 'nano_banana_image_prompt';
        this.DEFAULT_PROMPT_GPT_IMAGE = "Create a modern, flat vector illustration for a tech blog post about: ${topic}. \n\nStyle: Minimalist, clean lines, corporate colors (blue, grey, white). \nUse metaphors related to: ${text.substring(0, 500)} \nNo text in the image.";
        this.DEFAULT_PROMPT_NANO = "Generate a photorealistic image for a post about ${topic}. Context: ${text.substring(0, 500)}. High quality, professional lighting.";
        if (process.env.OPENAI_API_KEY) {
            this.openai = new openai_1.default({
                apiKey: process.env.OPENAI_API_KEY,
            });
        }
        if (process.env.GOOGLE_API_KEY) {
            try {
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
            }
            catch (e) {
                console.error('Failed to initialize Google AI', e);
            }
        }
    }
    async logImageInvocation(input) {
        if (!input.projectId)
            return;
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
                    estimated_cost_usd: (0, model_policy_service_1.estimateImageCostUsd)(input.model) ?? undefined,
                    latency_ms: input.latencyMs,
                    provider_request_id: input.providerRequestId,
                    invocation_metadata: input.metadata
                }
            });
        }
        catch (error) {
            console.error('Failed to log image invocation', error);
        }
    }
    async getImagePromptTemplate(projectId, provider = 'gpt-image') {
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
            if (setting)
                return setting.value;
            // If not set, initialize with default (safely)
            try {
                await prisma.projectSettings.create({
                    data: {
                        project_id: projectId,
                        key: key,
                        value: defaultPrompt
                    }
                });
            }
            catch (e) {
                // Ignore race condition if another process already created it
            }
            return defaultPrompt;
        }
        catch (e) {
            console.error(`Error fetching image prompt template for ${provider}`, e);
            return defaultPrompt;
        }
    }
    async updateImagePromptTemplate(projectId, value, provider = 'gpt-image') {
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
    async generateTopics(projectId, theme, weekId, promptOverride, count = 5, existingTopics = []) {
        return await multi_agent_service_1.default.refineTopics(projectId, theme, weekId, promptOverride, count, existingTopics);
    }
    async generatePostText(projectId, theme, topic, postId, promptOverride, withImage = false) {
        const result = await multi_agent_service_1.default.runPostGeneration(projectId, theme, topic, postId, promptOverride, withImage);
        return {
            text: result.finalText,
            category: result.category,
            tags: result.tags
        };
    }
    async generateContentItemText(contentItemId) {
        const item = await prisma.contentItem.findUnique({
            where: { id: contentItemId },
            include: { week_package: true }
        });
        if (!item || !item.week_package)
            throw new Error("ContentItem or WeekPackage not found");
        const theme = item.week_package.week_theme || '';
        const topic = item.title || item.brief || 'Unknown topic';
        // For MVP, reuse the existing runPostGeneration logic but point it to this ContentItem's topic
        // A more advanced integration would pass the ContentItem's specific requirements (layer, CTA) 
        // to a dedicated v2 prompt.
        const promptOverride = `Ты — Автор контента. Тема недели: ${theme}. Тезис: ${item.week_package.core_thesis}.
Твоя задача — написать черновик:
Формат: ${item.type} (Слой: ${item.layer || 'общий'})
Заголовок: ${item.title}
Детали: ${item.brief}
Ключевые пункты: ${(item.key_points || []).join(', ')}
CTA: ${item.cta || 'Нет'}

Пиши сразу текст, без мета-комментариев.`;
        // Mocking postId as 0 since we capture the output directly and will save it to ContentItem manually
        const result = await multi_agent_service_1.default.runPostGeneration(item.project_id, theme, topic, 0, promptOverride, false);
        await prisma.contentItem.update({
            where: { id: item.id },
            data: { draft_text: result.finalText, status: 'drafted', quality_report: result.history }
        });
        return result.finalText;
    }
    async generateImagePrompt(projectId, topic, text, provider = 'gpt-image') {
        let template = await this.getImagePromptTemplate(projectId, provider);
        // Replace placeholders safely
        const filledPrompt = template
            .replace('${topic}', topic)
            .replace('${text.substring(0, 500)}', text.substring(0, 500));
        const response = await this.openai.chat.completions.create({
            model: (0, model_policy_service_1.modelForRole)('precision_fixer'),
            messages: [{ role: 'user', content: filledPrompt }], // Simplification: just use the template as the prompt
        });
        const generatedPrompt = response.choices[0].message.content || '';
        return generatedPrompt;
    }
    async generateImage(prompt, projectId) {
        const startedAt = Date.now();
        const model = (process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL).trim();
        try {
            const response = await this.openai.images.generate({
                model,
                prompt: prompt,
                n: 1,
                size: "1024x1024",
            });
            if (!response.data || !response.data[0]) {
                throw new Error('No image data returned from GPT-Image');
            }
            const item = response.data[0];
            let buffer;
            if (item.b64_json) {
                buffer = Buffer.from(item.b64_json, 'base64');
            }
            else if (item.url) {
                const downloadRes = await fetch(item.url);
                if (!downloadRes.ok)
                    throw new Error(`Failed to download image from URL: ${downloadRes.statusText}`);
                const arrayBuffer = await downloadRes.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
            }
            else {
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
        }
        catch (e) {
            console.error('Failed to generate image (GPT-Image)', e);
            await this.logImageInvocation({ projectId, status: 'failed', provider: 'openai', model, prompt, error: e?.message || String(e), latencyMs: Date.now() - startedAt });
            throw e;
        }
    }
    async downloadAndSaveImage(url, filename) {
        try {
            const response = await fetch(url);
            if (!response.ok)
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const storageService = require('./storage.service').default;
            return await storageService.uploadFileFromBuffer(buffer, 'image/png', `generated/${filename}`);
        }
        catch (e) {
            console.error('Failed to upload generated image to storage', e);
            throw e;
        }
    }
    async generateImageNanoBanana(prompt, referenceImageBase64, requestedModel, projectId) {
        if (!process.env.GOOGLE_API_KEY) {
            throw new Error('GOOGLE_API_KEY is not set');
        }
        const startedAt = Date.now();
        let model = '';
        try {
            model = resolveGoogleImageModel(requestedModel);
            const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;
            const referenceMatch = referenceImageBase64?.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
            const promptParts = [{ text: prompt }];
            if (referenceMatch) {
                promptParts.push({
                    inline_data: {
                        mime_type: referenceMatch[1],
                        data: referenceMatch[2]
                    }
                });
            }
            const sendRequest = async (parts) => {
                return await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': process.env.GOOGLE_API_KEY
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
            const data = await response.json();
            const parts = data?.candidates?.[0]?.content?.parts;
            const imagePart = Array.isArray(parts)
                ? parts.find((part) => part?.inlineData?.data || part?.inline_data?.data)
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
        }
        catch (e) {
            console.error('Failed to generate image (Nano Banana)', e);
            await this.logImageInvocation({ projectId, status: 'failed', provider: 'google', model: model || requestedModel || DEFAULT_GOOGLE_IMAGE_MODEL, prompt, error: e?.message || String(e), latencyMs: Date.now() - startedAt });
            throw e;
        }
    }
}
exports.default = new GeneratorService();
