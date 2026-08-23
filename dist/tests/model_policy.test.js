"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const model_policy_service_1 = require("../services/model_policy.service");
(0, node_test_1.default)('model policy assigns cheap models to high-volume support roles', () => {
    strict_1.default.equal((0, model_policy_service_1.modelForRole)('post_creator'), 'gpt-4o');
    strict_1.default.equal((0, model_policy_service_1.modelForRole)('topic_creator'), 'gpt-4o');
    strict_1.default.equal((0, model_policy_service_1.modelForRole)('post_critic'), 'gpt-4o-mini');
    strict_1.default.equal((0, model_policy_service_1.modelForRole)('topic_fixer'), 'gpt-4o-mini');
    strict_1.default.equal((0, model_policy_service_1.modelForRole)('structural_critic'), 'gpt-4o-mini');
    strict_1.default.equal((0, model_policy_service_1.modelForRole)('classifier'), 'gpt-4o-mini');
});
(0, node_test_1.default)('model policy allows modern GPT model identifiers without silent fallback', () => {
    strict_1.default.equal((0, model_policy_service_1.inferModelProvider)('gpt-5.4-pro'), 'openai');
    strict_1.default.doesNotThrow(() => (0, model_policy_service_1.preflightModel)({ model: 'gpt-5.4-pro', apiKey: 'sk-test' }));
});
(0, node_test_1.default)('preflight rejects provider/model mismatch before a paid request', () => {
    strict_1.default.throws(() => (0, model_policy_service_1.preflightModel)({ model: 'gemini-3.1-flash-lite', apiKey: 'sk-test' }), /MODEL_PROVIDER_MISMATCH/);
});
(0, node_test_1.default)('invocation preflight rejects missing provider credentials', () => {
    strict_1.default.throws(() => (0, model_policy_service_1.preflightInvocation)({ model: 'gpt-4o-mini', apiKey: '' }), /MODEL_PROVIDER_NOT_CONFIGURED/);
});
(0, node_test_1.default)('cost estimator records known OpenAI usage including cached input', () => {
    const cost = (0, model_policy_service_1.estimateModelCostUsd)({
        model: 'gpt-4o-mini',
        inputTokens: 1000000,
        outputTokens: 1000000,
        cachedInputTokens: 200000
    });
    strict_1.default.equal(cost, 0.735);
});
(0, node_test_1.default)('image policy separates draft, final and flagship execution', () => {
    strict_1.default.deepEqual((0, model_policy_service_1.resolveImageExecutionPlan)('preview'), {
        mode: 'preview',
        provider: 'google',
        model: 'gemini-3.1-flash-lite-image',
        runPromptChain: false,
        runVisionCritic: false
    });
    strict_1.default.equal((0, model_policy_service_1.resolveImageExecutionPlan)('final').model, 'gemini-3.1-flash-image');
    strict_1.default.deepEqual((0, model_policy_service_1.resolveImageExecutionPlan)('flagship'), {
        mode: 'flagship',
        provider: 'openai+google',
        model: 'gpt-image-2+gemini-3.1-flash-image',
        runPromptChain: true,
        runVisionCritic: true
    });
});
