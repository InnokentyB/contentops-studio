"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const generator_service_1 = __importDefault(require("../services/generator.service"));
(0, node_test_1.default)('generateImageNanoBanana uses the current Gemini image generation contract', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GOOGLE_API_KEY;
    const originalModel = process.env.GOOGLE_IMAGE_MODEL;
    const requests = [];
    process.env.GOOGLE_API_KEY = 'test-google-key';
    delete process.env.GOOGLE_IMAGE_MODEL;
    globalThis.fetch = (async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({
            candidates: [{
                    content: {
                        parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' } }]
                    }
                }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    try {
        const result = await generator_service_1.default.generateImageNanoBanana('Draw a release checklist');
        strict_1.default.equal(result, 'data:image/png;base64,ZmFrZS1pbWFnZQ==');
        strict_1.default.equal(requests.length, 1);
        strict_1.default.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent');
        strict_1.default.equal((requests[0].init?.headers)['x-goog-api-key'], 'test-google-key');
        strict_1.default.ok(!requests[0].url.includes('test-google-key'));
        const body = JSON.parse(String(requests[0].init?.body));
        strict_1.default.deepEqual(body.contents, [{ parts: [{ text: 'Draw a release checklist' }] }]);
        strict_1.default.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
    }
    finally {
        globalThis.fetch = originalFetch;
        process.env.GOOGLE_API_KEY = originalApiKey;
        if (originalModel === undefined)
            delete process.env.GOOGLE_IMAGE_MODEL;
        else
            process.env.GOOGLE_IMAGE_MODEL = originalModel;
    }
});
(0, node_test_1.default)('generateImageNanoBanana ignores the retired Imagen model override', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.GOOGLE_API_KEY;
    const originalModel = process.env.GOOGLE_IMAGE_MODEL;
    let requestedUrl = '';
    process.env.GOOGLE_API_KEY = 'test-google-key';
    process.env.GOOGLE_IMAGE_MODEL = 'imagen-4.0-generate-001';
    globalThis.fetch = (async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'ZmFrZQ==' } }] } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    try {
        await generator_service_1.default.generateImageNanoBanana('Draw a safe fallback');
        strict_1.default.match(requestedUrl, /gemini-3\.1-flash-image:generateContent$/);
        strict_1.default.doesNotMatch(requestedUrl, /imagen-4\.0-generate-001/);
    }
    finally {
        globalThis.fetch = originalFetch;
        process.env.GOOGLE_API_KEY = originalApiKey;
        if (originalModel === undefined)
            delete process.env.GOOGLE_IMAGE_MODEL;
        else
            process.env.GOOGLE_IMAGE_MODEL = originalModel;
    }
});
