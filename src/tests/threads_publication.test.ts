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

test('ThreadsService.testConnection rejects missing access token', async () => {
    const res = await threadsService.testConnection({ access_token: '' });
    assert.equal(res.success, false);
    assert.equal(res.error, 'Access token is required');
});

test('ThreadsService.testConnection succeeds with valid token and matching user id', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
        assert.ok(url.toString().includes('graph.threads.net/v1.0/me'));
        assert.ok(url.toString().includes('valid_token_xyz'));
        return {
            ok: true,
            json: async () => ({
                id: '123456789',
                username: 'alice_writer',
                name: 'Alice Writer',
                threads_profile_picture_url: 'https://example.com/pic.jpg'
            })
        } as any;
    };

    try {
        const res = await threadsService.testConnection({
            access_token: 'valid_token_xyz',
            threads_user_id: '123456789'
        });
        assert.equal(res.success, true);
        assert.equal(res.details?.id, '123456789');
        assert.equal(res.details?.username, 'alice_writer');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService.testConnection flags user id mismatch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
            id: '999999999',
            username: 'bob_actual',
            name: 'Bob Actual'
        })
    } as any);

    try {
        const res = await threadsService.testConnection({
            access_token: 'token_for_bob',
            threads_user_id: '111111111'
        });
        assert.equal(res.success, false);
        assert.ok(res.error?.includes('Threads User ID mismatch'));
        assert.ok(res.error?.includes('bob_actual'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService.testConnection handles Meta API error response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Invalid OAuth 2.0 Access Token' } })
    } as any);

    try {
        const res = await threadsService.testConnection({
            access_token: 'expired_or_invalid'
        });
        assert.equal(res.success, false);
        assert.ok(res.error?.includes('401'));
        assert.ok(res.error?.includes('Invalid OAuth 2.0 Access Token'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});
