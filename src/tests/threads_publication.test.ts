import test from 'node:test';
import assert from 'node:assert/strict';
import threadsService, { ThreadsProviderError, ThreadsService } from '../services/threads.service';

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

        if (url.toString().includes('/mock_post_id_456?fields=id%2Cpermalink')) {
            return { ok: true, json: async () => ({ id: 'mock_post_id_456', permalink: 'https://www.threads.net/@alice/post/REAL456' }) } as any;
        }

        return { ok: false, statusText: 'Not Found' } as any;
    };

    try {
        const postUrl = await threadsService.publishPost('user123', 'token456', 'Hello Threads!');
        
        assert.equal(postUrl, 'https://www.threads.net/@alice/post/REAL456');
        assert.equal(requestedUrls.length, 3);
        assert.ok(requestedUrls[0].includes('/user123/threads'));
        assert.ok(requestedUrls[1].includes('/user123/threads_publish'));

        assert.equal(requestBodies[0].media_type, 'TEXT');
        assert.equal(requestBodies[0].text, 'Hello Threads!');
        assert.equal(requestBodies[1].creation_id, 'mock_container_id_123');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService accepts the current provider threads.com permalink', async () => {
    const originalFetch = globalThis.fetch;
    const responses = [
        { id: 'container-1' },
        { id: 'post-1' },
        { id: 'post-1', permalink: 'https://www.threads.com/@owner/post/current-code' }
    ];
    globalThis.fetch = async () => ({ ok: true, json: async () => responses.shift() }) as Response;
    try {
        assert.equal(await new ThreadsService().publishPost('user-1', 'token', 'hello'),
            'https://www.threads.com/@owner/post/current-code');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService.publishPost waits for an image container and returns the provider permalink', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const requestBodies: any[] = [];

    let statusChecks = 0;
    globalThis.fetch = async (url: any, options: any = {}) => {
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

        if (url.toString().includes('/mock_container_id_789?fields=status%2Cerror_message')) {
            statusChecks += 1;
            return { ok: true, json: async () => ({ status: statusChecks === 1 ? 'IN_PROGRESS' : 'FINISHED' }) } as any;
        }

        if (url.toString().includes('/mock_post_id_999?fields=id%2Cpermalink')) {
            return { ok: true, json: async () => ({ id: 'mock_post_id_999', permalink: 'https://www.threads.net/@alice/post/REAL999' }) } as any;
        }

        return { ok: false, statusText: 'Not Found' } as any;
    };

    try {
        const service = new ThreadsService({ pollIntervalMs: 0 });
        const postUrl = await service.publishPost('user123', 'token456', 'Check this out!', 'https://example.com/image.jpg');
        
        assert.equal(postUrl, 'https://www.threads.net/@alice/post/REAL999');
        assert.equal(statusChecks, 2);
        assert.equal(requestBodies[0].media_type, 'IMAGE');
        assert.equal(requestBodies[0].image_url, 'https://example.com/image.jpg');
        assert.equal(requestBodies[0].text, 'Check this out!');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService.publishThread creates a root and ordered replies', async () => {
    const originalFetch = globalThis.fetch;
    const createBodies: any[] = [];
    let sequence = 0;
    globalThis.fetch = async (url: any, options: any) => {
        const body = JSON.parse(options.body || '{}');
        if (url.toString().endsWith('/threads')) {
            createBodies.push(body);
            sequence += 1;
            return { ok: true, json: async () => ({ id: `container-${sequence}` }) } as any;
        }
        if (url.toString().endsWith('/threads_publish')) {
            return { ok: true, json: async () => ({ id: `post-${sequence}` }) } as any;
        }
        const postMatch = url.toString().match(/\/(post-\d+)\?fields=id%2Cpermalink$/);
        if (postMatch) {
            return { ok: true, json: async () => ({ id: postMatch[1], permalink: `https://www.threads.net/@alice/post/${postMatch[1]}` }) } as any;
        }
        return { ok: false, statusText: 'Not Found' } as any;
    };
    try {
        const result = await threadsService.publishThread('user123', 'token456', ['one', 'two', 'three']);
        assert.equal(result.rootUrl, 'https://www.threads.net/@alice/post/post-1');
        assert.equal(createBodies[0].reply_to_id, undefined);
        assert.equal(createBodies[1].reply_to_id, 'post-1');
        assert.equal(createBodies[2].reply_to_id, 'post-2');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService never puts the access token in request URLs', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';

    let authorization = '';
    globalThis.fetch = async (url: any, options: any = {}) => {
        requestedUrl = url.toString();
        authorization = options.headers?.Authorization;
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

        assert.ok(metrics);
        assert.ok(requestedUrl.includes('/post_id_abc/insights'));
        assert.ok(requestedUrl.includes('metric=likes,replies,reposts,quotes'));
        assert.ok(!requestedUrl.includes('token456'));
        assert.equal(authorization, 'Bearer token456');
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
    globalThis.fetch = async (url: any, options: any = {}) => {
        assert.ok(url.toString().includes('graph.threads.net/v1.0/me'));
        assert.ok(!url.toString().includes('valid_token_xyz'));
        assert.equal(options.headers?.Authorization, 'Bearer valid_token_xyz');
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

test('ThreadsService redacts provider response bodies in typed errors', async () => {
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
        assert.ok(!res.error?.includes('Invalid OAuth 2.0 Access Token'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService rejects a missing or untrusted provider permalink', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
        if (url.toString().endsWith('/threads')) return { ok: true, json: async () => ({ id: 'container' }) } as any;
        if (url.toString().endsWith('/threads_publish')) return { ok: true, json: async () => ({ id: 'post' }) } as any;
        return { ok: true, json: async () => ({ id: 'post', permalink: 'https://evil.example/post/post' }) } as any;
    };
    try {
        await assert.rejects(
            threadsService.publishPost('user123', 'super-secret-token', 'hello'),
            (error: unknown) => error instanceof ThreadsProviderError
                && error.code === 'THREADS_INVALID_PERMALINK'
                && !error.message.includes('super-secret-token')
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService bounds image container polling', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
        if (url.toString().endsWith('/threads')) return { ok: true, json: async () => ({ id: 'container' }) } as any;
        return { ok: true, json: async () => ({ status: 'IN_PROGRESS' }) } as any;
    };
    try {
        const service = new ThreadsService({ pollAttempts: 2, pollIntervalMs: 0 });
        await assert.rejects(
            service.publishPost('user123', 'token456', 'image', 'https://example.com/image.jpg'),
            (error: unknown) => error instanceof ThreadsProviderError && error.code === 'THREADS_CONTAINER_TIMEOUT'
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ThreadsService searches public posts with bounded encoded parameters and Bearer auth', async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    let authorization = '';
    globalThis.fetch = async (url: any, options: any = {}) => {
        requestedUrl = url.toString();
        authorization = options.headers?.Authorization;
        return { ok: true, json: async () => ({
            data: [{ id: 'post-1', text: 'AI agents', username: 'alice', permalink: 'https://www.threads.com/@alice/post/one' }],
            paging: { cursors: { after: 'cursor-2' } }
        }) } as Response;
    };
    try {
        const result = await new ThreadsService().searchPosts('secret-token', {
            query: 'AI agents & product', searchType: 'RECENT', limit: 7
        });
        const url = new URL(requestedUrl);
        assert.equal(url.pathname, '/v1.0/keyword_search');
        assert.equal(url.searchParams.get('q'), 'AI agents & product');
        assert.equal(url.searchParams.get('search_type'), 'RECENT');
        assert.equal(url.searchParams.get('limit'), '7');
        assert.equal(url.searchParams.has('access_token'), false);
        assert.equal(authorization, 'Bearer secret-token');
        assert.equal(result.items[0].id, 'post-1');
        assert.equal(result.after, 'cursor-2');
    } finally { globalThis.fetch = originalFetch; }
});

test('ThreadsService reads direct replies and full conversation through distinct endpoints', async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (url: any) => {
        urls.push(url.toString());
        return { ok: true, json: async () => ({ data: [{ id: 'reply-1', is_reply: true }] }) } as Response;
    };
    try {
        const service = new ThreadsService();
        await service.getReplies('token', 'root/unsafe', { mode: 'replies', reverse: true, limit: 5 });
        await service.getReplies('token', 'root/unsafe', { mode: 'conversation', reverse: false, limit: 10 });
        assert.match(urls[0], /root%2Funsafe\/replies\?/);
        assert.match(urls[1], /root%2Funsafe\/conversation\?/);
        assert.equal(new URL(urls[0]).searchParams.get('reverse'), 'true');
        assert.equal(new URL(urls[1]).searchParams.get('reverse'), 'false');
    } finally { globalThis.fetch = originalFetch; }
});

test('ThreadsService publishes a reply as a reply container and returns provider identity', async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (url: any, options: any = {}) => {
        const value = url.toString();
        if (options.body) bodies.push(JSON.parse(options.body));
        if (value.endsWith('/threads')) return { ok: true, json: async () => ({ id: 'container-1' }) } as Response;
        if (value.endsWith('/threads_publish')) return { ok: true, json: async () => ({ id: 'reply-9' }) } as Response;
        return { ok: true, json: async () => ({ id: 'reply-9', permalink: 'https://www.threads.com/@me/post/reply9' }) } as Response;
    };
    try {
        const result = await new ThreadsService().publishReply('me-1', 'token', 'target-7', 'Useful point');
        assert.deepEqual(bodies[0], { media_type: 'TEXT', text: 'Useful point', reply_to_id: 'target-7' });
        assert.deepEqual(result, { id: 'reply-9', url: 'https://www.threads.com/@me/post/reply9' });
    } finally { globalThis.fetch = originalFetch; }
});
