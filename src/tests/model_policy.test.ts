import test from 'node:test';
import assert from 'node:assert/strict';
import {
    estimateModelCostUsd,
    inferModelProvider,
    modelForRole,
    preflightInvocation,
    preflightModel,
    resolveImageExecutionPlan
} from '../services/model_policy.service';

test('model policy assigns cheap models to high-volume support roles', () => {
    assert.equal(modelForRole('post_creator'), 'gpt-4o');
    assert.equal(modelForRole('topic_creator'), 'gpt-4o');
    assert.equal(modelForRole('post_critic'), 'gpt-4o-mini');
    assert.equal(modelForRole('topic_fixer'), 'gpt-4o-mini');
    assert.equal(modelForRole('structural_critic'), 'gpt-4o-mini');
    assert.equal(modelForRole('classifier'), 'gpt-4o-mini');
});

test('model policy allows modern GPT model identifiers without silent fallback', () => {
    assert.equal(inferModelProvider('gpt-5.4-pro'), 'openai');
    assert.doesNotThrow(() => preflightModel({ model: 'gpt-5.4-pro', apiKey: 'sk-test' }));
});

test('preflight rejects provider/model mismatch before a paid request', () => {
    assert.throws(
        () => preflightModel({ model: 'gemini-3.1-flash-lite', apiKey: 'sk-test' }),
        /MODEL_PROVIDER_MISMATCH/
    );
});

test('invocation preflight rejects missing provider credentials', () => {
    assert.throws(() => preflightInvocation({ model: 'gpt-4o-mini', apiKey: '' }), /MODEL_PROVIDER_NOT_CONFIGURED/);
});

test('cost estimator records known OpenAI usage including cached input', () => {
    const cost = estimateModelCostUsd({
        model: 'gpt-4o-mini',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cachedInputTokens: 200_000
    });
    assert.equal(cost, 0.735);
});

test('image policy separates draft, final and flagship execution', () => {
    assert.deepEqual(resolveImageExecutionPlan('preview'), {
        mode: 'preview',
        provider: 'google',
        model: 'gemini-3.1-flash-lite-image',
        runPromptChain: false,
        runVisionCritic: false
    });
    assert.equal(resolveImageExecutionPlan('final').model, 'gemini-3.1-flash-image');
    assert.deepEqual(resolveImageExecutionPlan('flagship'), {
        mode: 'flagship',
        provider: 'openai+google',
        model: 'gpt-image-2+gemini-3.1-flash-image',
        runPromptChain: true,
        runVisionCritic: true
    });
});
