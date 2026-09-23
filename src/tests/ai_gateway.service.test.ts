import test from 'node:test';
import assert from 'node:assert/strict';
import aiGateway, { AiGatewayService } from '../services/ai_gateway.service';

test('AiGatewayService pools OpenAI client instances', () => {
    const gateway = new AiGatewayService();
    const client1 = gateway.getOpenAIClient('sk-test-123', 30000);
    const client2 = gateway.getOpenAIClient('sk-test-123', 30000);
    const client3 = gateway.getOpenAIClient('sk-test-123', 45000);
    const client4 = gateway.getOpenAIClient('sk-test-456', 30000);

    assert.equal(client1, client2, 'Clients with identical key and timeout must be reused');
    assert.notEqual(client1, client3, 'Clients with different timeouts must have separate instances');
    assert.notEqual(client1, client4, 'Clients with different keys must have separate instances');
});

test('AiGatewayService pools Anthropic and Google clients', () => {
    const gateway = new AiGatewayService();
    const anthropic1 = gateway.getAnthropicClient('sk-ant-123', 30000);
    const anthropic2 = gateway.getAnthropicClient('sk-ant-123', 30000);
    assert.equal(anthropic1, anthropic2);

    const google1 = gateway.getGoogleGenerativeAI('AIzaTest123');
    const google2 = gateway.getGoogleGenerativeAI('AIzaTest123');
    assert.equal(google1, google2);
});

test('AiGatewayService resolveApiKey falls back to environment variables', async () => {
    const originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'sk-env-openai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    process.env.GOOGLE_API_KEY = 'AIza-env';

    try {
        const openaiKey = await aiGateway.resolveApiKey(null, 'openai');
        assert.equal(openaiKey, 'sk-env-openai');

        const anthropicKey = await aiGateway.resolveApiKey(null, 'anthropic');
        assert.equal(anthropicKey, 'sk-ant-env');

        const googleKey = await aiGateway.resolveApiKey(null, 'google');
        assert.equal(googleKey, 'AIza-env');

        // Explicit key takes precedence
        const explicitKey = await aiGateway.resolveApiKey(null, 'openai', 'sk-explicit');
        assert.equal(explicitKey, 'sk-explicit');
    } finally {
        process.env = originalEnv;
    }
});

test('AiGatewayService complete throws when API key is missing', async () => {
    await assert.rejects(
        async () => {
            await aiGateway.complete({
                model: 'gpt-4o',
                apiKey: '',
                userPrompt: 'Hello'
            });
        },
        /MODEL_PROVIDER_NOT_CONFIGURED/
    );
});

test('AiGatewayService complete throws when model family is unknown', async () => {
    await assert.rejects(
        async () => {
            await aiGateway.complete({
                model: 'unknown-model-xyz',
                apiKey: 'sk-123',
                userPrompt: 'Hello'
            });
        },
        /MODEL_NOT_SUPPORTED/
    );
});
