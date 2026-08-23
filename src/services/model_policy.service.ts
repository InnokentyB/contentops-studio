export type ModelProvider = 'openai' | 'anthropic' | 'google';
export type ImageExecutionMode = 'preview' | 'final' | 'flagship';

const SUPPORT_ROLES = new Set([
    'post_critic',
    'post_fixer',
    'topic_critic',
    'topic_fixer',
    'structural_critic',
    'precision_fixer',
    'classifier',
    'seq_critic',
    'seq_fixer'
]);

type Pricing = { input: number; cachedInput?: number; output: number };

const PRICE_PER_MILLION_TOKENS: Record<string, Pricing> = {
    'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
    'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
    'gpt-5.6-luna': { input: 0.2, output: 1.2 },
    'gpt-5.6-terra': { input: 2, output: 12 },
    'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
    'claude-haiku-4-5': { input: 1, output: 5 }
};

export function inferModelProvider(model: string): ModelProvider {
    const normalized = model.trim().toLowerCase();
    if (/^(gpt-|o1(?:-|$)|o3(?:-|$)|o4(?:-|$)|chatgpt-)/.test(normalized)) return 'openai';
    if (normalized.startsWith('claude-')) return 'anthropic';
    if (normalized.startsWith('gemini-')) return 'google';
    throw new Error(`[MODEL_NOT_SUPPORTED] Unknown model family: ${model}`);
}

export function inferKeyProvider(apiKey?: string | null): ModelProvider | null {
    const key = (apiKey || '').trim();
    if (!key) return null;
    if (key.startsWith('sk-ant')) return 'anthropic';
    if (key.startsWith('AIza')) return 'google';
    if (key.startsWith('sk-')) return 'openai';
    return null;
}

export function preflightModel(config: { model: string; apiKey?: string | null }): ModelProvider {
    const provider = inferModelProvider(config.model);
    const keyProvider = inferKeyProvider(config.apiKey);
    if (keyProvider && keyProvider !== provider) {
        throw new Error(`[MODEL_PROVIDER_MISMATCH] ${config.model} requires ${provider}, but the configured key belongs to ${keyProvider}`);
    }
    return provider;
}

export function preflightInvocation(config: { model: string; apiKey?: string | null }): ModelProvider {
    const provider = preflightModel(config);
    if (!(config.apiKey || '').trim()) {
        throw new Error(`[MODEL_PROVIDER_NOT_CONFIGURED] Missing ${provider} API key for ${config.model}`);
    }
    return provider;
}

export function modelForRole(role: string): string {
    if (SUPPORT_ROLES.has(role)) {
        return process.env.LOW_COST_TEXT_MODEL?.trim() || 'gpt-4o-mini';
    }
    return process.env.STRONG_TEXT_MODEL?.trim() || 'gpt-4o';
}

export function estimateModelCostUsd(input: {
    model: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
}): number | null {
    const pricing = PRICE_PER_MILLION_TOKENS[input.model];
    if (!pricing) return null;
    const totalInput = Math.max(0, input.inputTokens || 0);
    const cachedInput = Math.min(totalInput, Math.max(0, input.cachedInputTokens || 0));
    const uncachedInput = totalInput - cachedInput;
    const output = Math.max(0, input.outputTokens || 0);
    const cost = (
        uncachedInput * pricing.input
        + cachedInput * (pricing.cachedInput ?? pricing.input)
        + output * pricing.output
    ) / 1_000_000;
    return Number(cost.toFixed(8));
}

export function estimateImageCostUsd(model: string): number | null {
    if (model === 'gemini-3.1-flash-lite-image') return 0.0336;
    if (model === 'gemini-3.1-flash-image') return 0.067;
    return null;
}

export function resolveImageExecutionPlan(mode: ImageExecutionMode) {
    if (mode === 'preview') {
        return {
            mode,
            provider: 'google' as const,
            model: 'gemini-3.1-flash-lite-image',
            runPromptChain: false,
            runVisionCritic: false
        };
    }
    if (mode === 'final') {
        return {
            mode,
            provider: 'google' as const,
            model: 'gemini-3.1-flash-image',
            runPromptChain: false,
            runVisionCritic: false
        };
    }
    return {
        mode,
        provider: 'openai+google' as const,
        model: 'gpt-image-2+gemini-3.1-flash-image',
        runPromptChain: true,
        runVisionCritic: true
    };
}
