import test from 'node:test';
import assert from 'node:assert/strict';
import threadsService from '../services/threads.service';

test('ThreadsService.publishPost publishes text post successfully', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const requestBodies: any[] = [];

    globalThis.fetch = async (url: any, options: any) => {
        requestedUrls.push(url.toString());
        requestBodies.push(JSON.parse(options.body || '{}'));

        if (url.toString().endsWith('/threads')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_container_id_123' })
            } as any;
        }

        if (url.toString().endsWith('/threads_publish')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_post_id_456' })
            } as any;
        }

        return { ok: false, statusText: 'Not Found' } as any;
    };

    try {
        const postUrl = await threadsService.publishPost('user123', 'token456', 'Hello Threads!');
        
        assert.equal(postUrl, 'https://www.threads.net/post/mock_post_id_456');
        assert.equal(requestedUrls.length, 2);
        assert.ok(requestedUrls[0].includes('/user123/threads'));
        assert.ok(requestedUrls[1].includes('/user123/threads_publish'));

        assert.equal(requestBodies[0].media_type, 'TEXT');
        assert.equal(requestBodies[0].text, 'Hello Threads!');
        assert.equal(requestBodies[1].creation_id, 'mock_container_id_123');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService.publishPost publishes image post successfully', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const requestBodies: any[] = [];

    globalThis.fetch = async (url: any, options: any) => {
        requestedUrls.push(url.toString());
        requestBodies.push(JSON.parse(options.body || '{}'));

        if (url.toString().endsWith('/threads')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_container_id_789' })
            } as any;
        }

        if (url.toString().endsWith('/threads_publish')) {
            return {
                ok: true,
                json: async () => ({ id: 'mock_post_id_999' })
            } as any;
        }

        return { ok: false, statusText: 'Not Found' } as any;
    };

    try {
        const postUrl = await threadsService.publishPost('user123', 'token456', 'Check this out!', 'https://example.com/image.jpg');
        
        assert.equal(postUrl, 'https://www.threads.net/post/mock_post_id_999');
        assert.equal(requestedUrls.length, 2);
        assert.equal(requestBodies[0].media_type, 'IMAGE');
        assert.equal(requestBodies[0].image_url, 'https://example.com/image.jpg');
        assert.equal(requestBodies[0].text, 'Check this out!');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService.getMetrics retrieves insights successfully', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';

    globalThis.fetch = async (url: any) => {
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
        } as any;
    };

    try {
        const metrics = await threadsService.getMetrics('post_id_abc', 'token456');

        assert.ok(requestedUrl.includes('/post_id_abc/insights'));
        assert.ok(requestedUrl.includes('metric=likes,replies,reposts,quotes'));
        assert.equal(metrics.likes, 42);
        assert.equal(metrics.comments, 7);
        assert.equal(metrics.reposts, 3);
        assert.ok(metrics.retrieved_at);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
