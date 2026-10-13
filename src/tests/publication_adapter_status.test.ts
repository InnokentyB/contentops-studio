import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

test('card status is authenticated, task-scoped, read-only and never accepts a client job/actor', async t => {
    const { registerPublicationAdapterStatus } = await import('../routes/api/publication_adapter_status');
    const calls: unknown[] = [];
    const app = Fastify();
    t.after(() => app.close());
    app.addHook('preHandler', async request => {
        Object.assign(request, { projectId: Number(request.headers['x-project']),
            user: request.headers['x-user'] ? { id: Number(request.headers['x-user']) } : undefined });
    });
    registerPublicationAdapterStatus(app, async identity => {
        calls.push(identity);
        if (identity.projectId !== 10 || identity.taskId !== 1048) return null;
        return { supported: true, canExecute: false, manualRecordAllowed: false,
            state: 'blocked', blocker: 'PROVIDER_PERMISSION_UNVERIFIED',
            connection: 'online', heartbeatAt: '2026-10-13T14:17:49.714Z',
            publicUrl: null, observedAt: '2026-10-13T14:17:52.496Z' };
    });
    assert.equal((await app.inject('/api/publication-tasks/1048/adapter-status')).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/publication-tasks/bad/adapter-status', headers: { 'x-project': '10', 'x-user': '2' } })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/publication-tasks/1048/adapter-status', headers: { 'x-project': '99', 'x-user': '2' } })).statusCode, 404);
    const response = await app.inject({ url: '/api/publication-tasks/1048/adapter-status?actorId=user:99&jobId=foreign', headers: { 'x-project': '10', 'x-user': '2' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().canExecute, false);
    assert.equal(response.json().blocker, 'PROVIDER_PERMISSION_UNVERIFIED');
    assert.deepEqual(calls[calls.length - 1], { projectId: 10, taskId: 1048, actorId: 'user:2' });
    assert.equal((await app.inject({ method: 'POST', url: '/api/publication-tasks/1048/adapter-status' })).statusCode, 404);
});

test('status failure exposes no provider payload or credential and fails closed', async t => {
    const { registerPublicationAdapterStatus } = await import('../routes/api/publication_adapter_status');
    const app = Fastify(); t.after(() => app.close());
    app.addHook('preHandler', async request => { Object.assign(request, { projectId: 10, user: { id: 2 } }); });
    registerPublicationAdapterStatus(app, async () => { throw new Error('private-provider-payload'); });
    const result = await app.inject('/api/publication-tasks/1048/adapter-status');
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.json(), { error: 'ADAPTER_STATUS_UNAVAILABLE' });
});
