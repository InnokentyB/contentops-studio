import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import prisma from '../db';
import {
    estimateModelCostUsd,
    inferModelProvider,
    ModelProvider,
    preflightInvocation
} from './model_policy.service';
import { safeDecryptProviderKey } from '../utils/channel_secrets';

export interface AiCompletionRequest {
    model: string;
    apiKey: string;
    userPrompt: string;
    systemPrompt?: string;
    json?: boolean;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    maxRetries?: number;
}

export interface AiGatewayResult {
    content: string;
    provider: ModelProvider;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    providerRequestId?: string;
    costUsd?: number | null;
    latencyMs: number;
}

export class AiGatewayService {
    private openaiClients = new Map<string, OpenAI>();
    private anthropicClients = new Map<string, Anthropic>();
    private googleClients = new Map<string, GoogleGenerativeAI>();
    private readonly defaultTimeoutMs = 45000;
    private readonly defaultMaxRetries = 2;

    /**
     * Returns a pooled or newly initialized OpenAI client.
     * @param apiKey The API key for OpenAI.
     * @param timeoutMs Request timeout in milliseconds (default 45000).
     */
    getOpenAIClient(apiKey: string, timeoutMs: number = this.defaultTimeoutMs): OpenAI {
        const key = `${apiKey}:${timeoutMs}`;
        let client = this.openaiClients.get(key);
        if (!client) {
            client = new OpenAI({
                apiKey,
                timeout: timeoutMs,
                maxRetries: 0 // Retries handled with policy in gateway
            });
            this.openaiClients.set(key, client);
        }
        return client;
    }

    /**
     * Returns a pooled or newly initialized Anthropic client.
     * @param apiKey The API key for Anthropic.
     * @param timeoutMs Request timeout in milliseconds (default 45000).
     */
    getAnthropicClient(apiKey: string, timeoutMs: number = this.defaultTimeoutMs): Anthropic {
        const key = `${apiKey}:${timeoutMs}`;
        let client = this.anthropicClients.get(key);
        if (!client) {
            client = new Anthropic({
                apiKey,
                timeout: timeoutMs,
                maxRetries: 0
            });
            this.anthropicClients.set(key, client);
        }
        return client;
    }

    /**
     * Returns a pooled or newly initialized GoogleGenerativeAI client.
     * @param apiKey The API key for Google Gemini.
     */
    getGoogleGenerativeAI(apiKey: string): GoogleGenerativeAI {
        let client = this.googleClients.get(apiKey);
        if (!client) {
            client = new GoogleGenerativeAI(apiKey);
            this.googleClients.set(apiKey, client);
        }
        return client;
    }

    /**
     * Resolves the effective API key for a given provider and project, decrypting if stored as pk_*.
     * @param projectId The project ID or null for global.
     * @param provider The model provider ('openai' | 'anthropic' | 'google').
     * @param explicitKey Optional explicit key or pk_* identifier.
     */
    async resolveApiKey(projectId: number | null, provider: ModelProvider, explicitKey?: string | null): Promise<string> {
        let key = (explicitKey || '').trim();

        if (key.startsWith('pk_')) {
            const keyId = parseInt(key.substring(3), 10);
            if (!isNaN(keyId)) {
                const providerKey = await prisma.providerKey.findUnique({
                    where: { id: keyId }
                });
                if (providerKey) {
                    key = safeDecryptProviderKey(providerKey.key);
                } else {
                    console.warn(`[AiGateway] Provider Key pk_${keyId} not found`);
                    key = '';
                }
            }
        }

        if (key) return key;

        // Fall back to environment variables
        if (provider === 'google') return process.env.GOOGLE_API_KEY?.trim() || '';
        if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY?.trim() || '';
        return process.env.OPENAI_API_KEY?.trim() || '';
    }

    /**
     * Executes an AI model completion request across any supported provider (OpenAI, Anthropic, Google).
     * Provides unified timeouts, retries, token usage telemetry, and cost accounting.
     * @param request The completion request payload.
     * @returns AiGatewayResult containing output content and usage metrics.
     */
    async complete(request: AiCompletionRequest): Promise<AiGatewayResult> {
        const provider = preflightInvocation({ model: request.model, apiKey: request.apiKey });
        const timeoutMs = request.timeoutMs || this.defaultTimeoutMs;
        const maxRetries = request.maxRetries ?? this.defaultMaxRetries;
        const startedAt = Date.now();

        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await this.executeCompletion(provider, request, timeoutMs);
                result.latencyMs = Date.now() - startedAt;
                result.costUsd = estimateModelCostUsd({
                    model: request.model,
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    cachedInputTokens: result.cachedInputTokens
                });
                return result;
            } catch (err: unknown) {
                lastError = err as Error;
                const isRetryable = this.isRetryableError(err);
                if (!isRetryable || attempt >= maxRetries) {
                    break;
                }
                const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }

        throw lastError || new Error(`[AiGateway] Model invocation failed for ${request.model}`);
    }

    private async executeCompletion(
        provider: ModelProvider,
        request: AiCompletionRequest,
        timeoutMs: number
    ): Promise<AiGatewayResult> {
        if (provider === 'anthropic') {
            const client = this.getAnthropicClient(request.apiKey, timeoutMs);
            const systemPrompt = (request.systemPrompt || '') + (request.json ? '\nIMPORTANT: return valid JSON only.' : '');
            
            const response = await client.messages.create({
                model: request.model,
                max_tokens: request.maxTokens || 4000,
                ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
                messages: [{ role: 'user', content: request.userPrompt }]
            });

            const content = response.content?.[0]?.type === 'text' ? response.content[0].text : '';
            return {
                content,
                provider,
                model: request.model,
                inputTokens: response.usage?.input_tokens,
                outputTokens: response.usage?.output_tokens,
                providerRequestId: response.id,
                latencyMs: 0
            };
        }

        if (provider === 'google') {
            const ai = this.getGoogleGenerativeAI(request.apiKey);
            const systemPrompt = (request.systemPrompt || '') + (request.json ? '\nIMPORTANT: return valid JSON only.' : '');

            const model = ai.getGenerativeModel(
                {
                    model: request.model,
                    systemInstruction: systemPrompt.trim() ? systemPrompt.trim() : undefined,
                    generationConfig: request.json ? { responseMimeType: 'application/json' } : undefined
                },
                {
                    timeout: timeoutMs
                }
            );

            const result = await model.generateContent(request.userPrompt);
            const response = result.response;
            const usage = response.usageMetadata;

            return {
                content: response.text(),
                provider,
                model: request.model,
                inputTokens: usage?.promptTokenCount,
                outputTokens: usage?.candidatesTokenCount,
                cachedInputTokens: usage?.cachedContentTokenCount,
                providerRequestId: (response as { responseId?: string }).responseId,
                latencyMs: 0
            };
        }

        // OpenAI
        const client = this.getOpenAIClient(request.apiKey, timeoutMs);
        const systemPrompt = (request.systemPrompt || '') + (request.json ? '\nReturn valid JSON only.' : '');

        if (request.model.toLowerCase().startsWith('gpt-5')) {
            const response = await (client as any).responses.create({
                model: request.model,
                instructions: systemPrompt.trim() || undefined,
                input: request.userPrompt
            });

            return {
                content: response.output_text || '',
                provider,
                model: request.model,
                inputTokens: response.usage?.input_tokens,
                outputTokens: response.usage?.output_tokens,
                cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens,
                reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens,
                providerRequestId: response.id,
                latencyMs: 0
            };
        }

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        if (systemPrompt.trim()) {
            messages.push({ role: 'system', content: systemPrompt.trim() });
        }
        messages.push({ role: 'user', content: request.userPrompt });

        const response = await client.chat.completions.create({
            model: request.model,
            messages,
            ...(request.json ? { response_format: { type: 'json_object' } } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {})
        });

        return {
            content: response.choices?.[0]?.message?.content || '',
            provider,
            model: request.model,
            inputTokens: response.usage?.prompt_tokens,
            outputTokens: response.usage?.completion_tokens,
            cachedInputTokens: response.usage?.prompt_tokens_details?.cached_tokens,
            reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens,
            providerRequestId: response.id,
            latencyMs: 0
        };
    }

    private isRetryableError(err: unknown): boolean {
        if (!err || typeof err !== 'object') return false;
        const error = err as { status?: number; statusCode?: number; code?: string; message?: string };
        const status = error.status || error.statusCode;
        if (status === 429 || (status !== undefined && status >= 500 && status <= 504)) {
            return true;
        }
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            return true;
        }
        return false;
    }
}

export default new AiGatewayService();
