import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { ThreadsService } from '../services/threads.service';

const Method = z.custom<(userId: string, token: string, text: string, username: string) => Promise<{
    id: string; url: string; publishedAt: string;
}>>(value => typeof value === 'function');

test('verified Threads send retains numeric API identity and checks provider readback', async t => {
    const service = new ThreadsService();
    const method = Method.parse(Reflect.get(service, 'publishVerifiedText'));
    const responses = [{ id: '100' }, { id: '200' },
        { permalink: 'https://www.threads.net/@innokentybo/post/SHORT' },
        { id: '200', username: 'innokentybo', text: 'Approved text',
            permalink: 'https://www.threads.net/@innokentybo/post/SHORT', timestamp: '2026-10-14T16:31:00Z' }];
    let writes = 0;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') writes += 1;
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    assert.deepEqual(await method.call(service, '39421253764155091', 'synthetic-token', 'Approved text', 'innokentybo'), {
        id: '200', url: 'https://www.threads.net/@innokentybo/post/SHORT', publishedAt: '2026-10-14T16:31:00Z'
    });
    assert.equal(writes, 2);
});

test('verified Threads send rejects wrong author without another write or leaking token', async t => {
    const service = new ThreadsService();
    const method = Method.parse(Reflect.get(service, 'publishVerifiedText'));
    const responses = [{ id: '100' }, { id: '200' },
        { permalink: 'https://www.threads.net/@innokentybo/post/SHORT' },
        { id: '200', username: 'other', text: 'Approved text',
            permalink: 'https://www.threads.net/@other/post/SHORT', timestamp: '2026-10-14T16:31:00Z' }];
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        calls += 1;
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
    });
    await assert.rejects(method.call(service, '39421253764155091', 'synthetic-token', 'Approved text', 'innokentybo'),
        /Threads provider request failed/);
    assert.equal(calls, 4);
});

for (const status of [401, 403, 429]) {
    test(`verified Threads send does not retry HTTP ${status} or expose provider payload`, async t => {
        const service = new ThreadsService();
        const method = Method.parse(Reflect.get(service, 'publishVerifiedText'));
        let calls = 0;
        t.mock.method(globalThis, 'fetch', async () => {
            calls += 1;
            return new Response('synthetic-private-provider-payload', { status });
        });
        await assert.rejects(method.call(service, '39421253764155091', 'synthetic-token', 'Approved text', 'innokentybo'),
            error => error instanceof Error && error.message.includes(`HTTP ${status}`)
                && !error.message.includes('synthetic'));
        assert.equal(calls, 1);
    });
}

test('verified Threads send never retries a network error after possible provider acceptance', async t => {
    const service = new ThreadsService();
    const method = Method.parse(Reflect.get(service, 'publishVerifiedText'));
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ id: '100' }), { status: 200 });
        throw new Error('synthetic-private-provider-payload');
    });
    await assert.rejects(method.call(service, '39421253764155091', 'synthetic-token', 'Approved text', 'innokentybo'),
        error => error instanceof Error && !error.message.includes('synthetic'));
    assert.equal(calls, 2);
});
