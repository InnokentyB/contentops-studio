"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const threads_service_1 = __importDefault(require("../services/threads.service"));
(0, node_test_1.default)('ThreadsService.publishPost publishes text post successfully', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];
    const requestBodies = [];
    globalThis.fetch = async (url, options) => {
        requestedUrls.push(url.toString());
        requestBodies.push(JSON.parse(options.body || '{}'));
        if (url.toString().endsWith('/threads')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_container_id_123' })
            };
        }
        if (url.toString().endsWith('/threads_publish')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_post_id_456' })
            };
        }
        return { ok: false, statusText: 'Not Found' };
    };
    try {
        const postUrl = await threads_service_1.default.publishPost('user123', 'token456', 'Hello Threads!');
        strict_1.default.equal(postUrl, 'https://www.threads.net/post/mock_post_id_456');
        strict_1.default.equal(requestedUrls.length, 2);
        strict_1.default.ok(requestedUrls[0].includes('/user123/threads'));
        strict_1.default.ok(requestedUrls[1].includes('/user123/threads_publish'));
        strict_1.default.equal(requestBodies[0].media_type, 'TEXT');
        strict_1.default.equal(requestBodies[0].text, 'Hello Threads!');
        strict_1.default.equal(requestBodies[1].creation_id, 'mock_container_id_123');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, node_test_1.default)('ThreadsService.publishPost publishes image post successfully', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];
    const requestBodies = [];
    globalThis.fetch = async (url, options) => {
        requestedUrls.push(url.toString());
        requestBodies.push(JSON.parse(options.body || '{}'));
        if (url.toString().endsWith('/threads')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_container_id_789' })
            };
        }
        if (url.toString().endsWith('/threads_publish')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_post_id_999' })
            };
        }
        return { ok: false, statusText: 'Not Found' };
    };
    try {
        const postUrl = await threads_service_1.default.publishPost('user123', 'token456', 'Check this out!', 'https://example.com/image.jpg');
        strict_1.default.equal(postUrl, 'https://www.threads.net/post/mock_post_id_999');
        strict_1.default.equal(requestedUrls.length, 2);
        strict_1.default.equal(requestBodies[0].media_type, 'IMAGE');
        strict_1.default.equal(requestBodies[0].image_url, 'https://example.com/image.jpg');
        strict_1.default.equal(requestBodies[0].text, 'Check this out!');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
(0, node_test_1.default)('ThreadsService.getMetrics retrieves insights successfully', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = async (url) => {
        requestedUrl = url.toString();
        return {
            ok: true,
            json: async () => ({
                data: [
                    { name: 'likes', values: [{ value: 42 }] },
                    { name: 'replies', values: [{ value: 7 }] },
                    { name: 'reposts', values: [{ value: 3 }] }
                ]
            })
        };
    };
    try {
        const metrics = await threads_service_1.default.getMetrics('post_id_abc', 'token456');
        strict_1.default.ok(requestedUrl.includes('/post_id_abc/insights'));
        strict_1.default.ok(requestedUrl.includes('metric=likes,replies,reposts,quotes'));
        strict_1.default.equal(metrics.likes, 42);
        strict_1.default.equal(metrics.comments, 7);
        strict_1.default.equal(metrics.reposts, 3);
        strict_1.default.ok(metrics.retrieved_at);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
