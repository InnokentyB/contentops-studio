import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import threadsComplianceRoutes from '../routes/threads_compliance.routes';
import { ThreadsComplianceService } from '../services/threads_compliance.service';

function base64url(value: string | Buffer) {
    return Buffer.from(value).toString('base64url');
}

function signedRequest(secret: string, payload: Record<string, unknown>) {
    const encodedPayload = base64url(JSON.stringify(payload));
    const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
    return `${signature}.${encodedPayload}`;
}

function makeDb() {
    const channels = [
        { id: 10, project_id: 1, type: 'threads', config: { threads_user_id: 'meta-7', access_token: 'secret-token', label: 'one' } },
        { id: 20, project_id: 2, type: 'threads', config: { threads_user_id: 'other', access_token: 'keep-me' } }
    ];
    const events: Array<Record<string, unknown>> = [];
    return {
        channels,
        events,
        db: {
            socialChannel: {
                findMany: async () => channels,
                findFirst: async ({ where }: any) => channels.find(row => row.id === where.id && row.project_id === where.project_id && row.type === where.type) || null,
                update: async ({ where, data }: any) => {
                    const row = channels.find(item => item.id === where.id)!;
                    row.config = data.config;
                    return row;
                }
            },
            event: { create: async ({ data }: any) => { events.push(data); return data; } },
            $transaction: async (fn: any) => fn({
                socialChannel: {
                    update: async ({ where, data }: any) => {
                        const row = channels.find(item => item.id === where.id)!;
                        row.config = data.config;
                        return row;
                    }
                },
                event: { create: async ({ data }: any) => { events.push(data); return data; } }
            })
        }
    };
}

async function appFixture() {
    const fixture = makeDb();
    const service = new ThreadsComplianceService({
        db: fixture.db as any,
        appSecret: 'meta-secret',
        stateSecret: 'state-secret',
        publicAppUrl: 'https://planner.example'
    });
    const app = Fastify({ logger: false });
    await app.register(threadsComplianceRoutes, {
        service,
        hasProjectOwnerAccess: async (userId: number, projectId: number) => userId === 1 && projectId === 1
    });
    return { app, service, ...fixture };
}

test('Threads OAuth callback rejects missing or forged state without echoing secrets', async () => {
    const { app } = await appFixture();
    const missing = await app.inject({ method: 'GET', url: '/api/integrations/threads/callback?code=private-code' });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().code, 'THREADS_OAUTH_CALLBACK_INVALID');
    assert.doesNotMatch(missing.body, /private-code/);

    const forged = await app.inject({ method: 'GET', url: '/api/integrations/threads/callback?code=private-code&state=forged' });
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().code, 'THREADS_OAUTH_STATE_INVALID');
    assert.doesNotMatch(forged.body, /private-code|forged/);
    await app.close();
});

test('Threads OAuth callback validates signed tenant binding then fails closed before token exchange', async () => {
    const { app, service } = await appFixture();
    const state = service.createOAuthState({ projectId: 1, channelId: 10, userId: 1 });
    const response = await app.inject({ method: 'GET', url: `/api/integrations/threads/callback?code=private-code&state=${encodeURIComponent(state)}` });
    assert.equal(response.statusCode, 501);
    assert.deepEqual(response.json(), {
        error: 'Threads OAuth token exchange is not configured',
        code: 'THREADS_OAUTH_EXCHANGE_NOT_IMPLEMENTED'
    });
    await app.close();
});

test('Threads deauthorization verifies Meta signed_request and revokes only the matching identity', async () => {
    const { app, channels, events } = await appFixture();
    const request = signedRequest('meta-secret', { algorithm: 'HMAC-SHA256', user_id: 'meta-7', issued_at: Math.floor(Date.now() / 1000) });
    const response = await app.inject({ method: 'POST', url: '/api/integrations/threads/deauthorize', payload: { signed_request: request } });
    assert.equal(response.statusCode, 200);
    assert.equal((channels[0].config as any).access_token, undefined);
    assert.equal((channels[0].config as any).threads_user_id, 'meta-7');
    assert.equal((channels[1].config as any).access_token, 'keep-me');
    assert.equal(events[0].event_type, 'threads.deauthorized');
    assert.doesNotMatch(JSON.stringify(events), /secret-token|meta-secret/);
    await app.close();
});

test('Threads data deletion clears matching identity and returns a non-secret confirmation URL', async () => {
    const { app, channels, events } = await appFixture();
    const request = signedRequest('meta-secret', { algorithm: 'HMAC-SHA256', user_id: 'meta-7', issued_at: Math.floor(Date.now() / 1000) });
    const response = await app.inject({ method: 'POST', url: '/api/integrations/threads/data-deletion', payload: { signed_request: request } });
    assert.equal(response.statusCode, 200);
    const result = response.json();
    assert.match(result.url, /^https:\/\/planner\.example\/api\/integrations\/threads\/data-deletion\/status\?code=/);
    assert.match(result.confirmation_code, /^[a-f0-9]{16}\.[a-f0-9]+\.[A-Za-z0-9_-]+$/);
    assert.equal((channels[0].config as any).access_token, undefined);
    assert.equal((channels[0].config as any).threads_user_id, undefined);
    assert.equal(events[0].event_type, 'threads.data_deleted');

    const status = await app.inject({ method: 'GET', url: `/api/integrations/threads/data-deletion/status?code=${result.confirmation_code}` });
    assert.deepEqual(status.json(), { status: 'completed', confirmation_code: result.confirmation_code });
    await app.close();
});

test('Threads compliance callbacks reject invalid Meta signatures without mutation', async () => {
    const { app, channels, events } = await appFixture();
    const response = await app.inject({ method: 'POST', url: '/api/integrations/threads/deauthorize', payload: { signed_request: 'bad.request' } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'THREADS_SIGNED_REQUEST_INVALID');
    assert.equal((channels[0].config as any).access_token, 'secret-token');
    assert.equal(events.length, 0);
    await app.close();
});

test('Threads OAuth callback cannot cross the signed project owner boundary', async () => {
    const { app, service } = await appFixture();
    const state = service.createOAuthState({ projectId: 2, channelId: 20, userId: 1 });
    const response = await app.inject({ method: 'GET', url: `/api/integrations/threads/callback?code=private-code&state=${encodeURIComponent(state)}` });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'THREADS_OAUTH_OWNER_REQUIRED');
    assert.doesNotMatch(response.body, /private-code/);
    await app.close();
});
