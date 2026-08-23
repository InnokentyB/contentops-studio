import test from 'node:test';
import assert from 'node:assert/strict';
import generatorService from '../services/generator.service';

test('generateImageNanoBanana uses the current Gemini image generation contract', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GOOGLE_API_KEY;
    const originalModel = process.env.GOOGLE_IMAGE_MODEL;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    process.env.GOOGLE_API_KEY = 'test-google-key';
    delete process.env.GOOGLE_IMAGE_MODEL;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({
            candidates: [{
                content: {
                    parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' } }]
                }
            }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
        const result = await generatorService.generateImageNanoBanana('Draw a release checklist');

        assert.equal(result, 'data:image/png;base64,ZmFrZS1pbWFnZQ==');
        assert.equal(requests.length, 1);
        assert.equal(
            requests[0].url,
            'https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent'
        );
        assert.equal((requests[0].init?.headers as Record<string, string>)['x-goog-api-key'], 'test-google-key');
        assert.ok(!requests[0].url.includes('test-google-key'));

        const body = JSON.parse(String(requests[0].init?.body));
        assert.deepEqual(body.contents, [{ parts: [{ text: 'Draw a release checklist' }] }]);
        assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GOOGLE_API_KEY = originalApiKey;
        if (originalModel === undefined) delete process.env.GOOGLE_IMAGE_MODEL;
        else process.env.GOOGLE_IMAGE_MODEL = originalModel;
    }
});

test('generateImageNanoBanana ignores the retired Imagen model override', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GOOGLE_API_KEY;
    const originalModel = process.env.GOOGLE_IMAGE_MODEL;
    let requestedUrl = '';

    process.env.GOOGLE_API_KEY = 'test-google-key';
    process.env.GOOGLE_IMAGE_MODEL = 'imagen-4.0-generate-001';
    globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'ZmFrZQ==' } }] } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
        await generatorService.generateImageNanoBanana('Draw a safe fallback');
        assert.match(requestedUrl, /gemini-3\.1-flash-image:generateContent$/);
        assert.doesNotMatch(requestedUrl, /imagen-4\.0-generate-001/);
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GOOGLE_API_KEY = originalApiKey;
        if (originalModel === undefined) delete process.env.GOOGLE_IMAGE_MODEL;
        else process.env.GOOGLE_IMAGE_MODEL = originalModel;
    }
});

test('generateImageNanoBanana can explicitly use the low-cost preview model', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GOOGLE_API_KEY;
    let requestedUrl = '';
    process.env.GOOGLE_API_KEY = 'test-google-key';
    globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
        await generatorService.generateImageNanoBanana('Draft visual', undefined, 'gemini-3.1-flash-lite-image');
        assert.match(requestedUrl, /gemini-3\.1-flash-lite-image:generateContent$/);
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GOOGLE_API_KEY = originalApiKey;
    }
});
