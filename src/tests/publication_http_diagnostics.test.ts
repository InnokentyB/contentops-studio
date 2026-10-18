import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import prisma from '../db';
import publicationTasksRoutes from '../routes/api/publication_tasks.routes';
import { publicationDispatcher } from '../services/publishers/publication_dispatcher';

test('actual publish-now HTTP response explains an accepted-package failure without raw provider data', async t => {
    const logs: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args); });
    let dispatchCalls = 0;
    t.mock.method(publicationDispatcher, 'processPublicationTaskNow', async () => {
        dispatchCalls += 1; throw new Error('[ACCEPTED_REVISION_REQUIRED] private-provider-payload');
    });
    const delegate = prisma.contentItem;
    const original = delegate.findFirst;
    Reflect.set(delegate, 'findFirst', async (args: { where: { project_id: number; id: number } }) => {
        assert.equal(args.where.project_id, 20); assert.equal(args.where.id, 5000);
        return { id: 5000, project_id: 20, channel: { type: 'telegram' } };
    });
    const server = Fastify();
    server.addHook('preHandler', (request, _reply, done) => { Reflect.set(request, 'projectId', 20); done(); });
    try {
        await server.register(publicationTasksRoutes);
        const response = await server.inject({ method: 'POST', url: '/api/publication-tasks/5000/publish-now' });
        assert.equal(response.statusCode, 400);
        const payload = response.json<{ error: string }>();
        assert.match(payload.error, /ACCEPTED_REVISION_REQUIRED/);
        assert.match(payload.error, /current text revision is not accepted/);
        assert.match(payload.error, /Complete review/);
        assert.ok(!JSON.stringify({ payload, logs }).includes('private-provider-payload'));
        assert.equal(dispatchCalls, 1); assert.equal(logs.length, 1);
    } finally { Reflect.set(delegate, 'findFirst', original); await server.close(); }
});

test('HTTP browser handoff keeps successful control state and removes raw fallback reason', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(publicationDispatcher, 'processPublicationTaskNow', async () => ({
        success: true, mode: 'browser', status: 'browser_required', adapter: 'linkedin', browserRequired: true,
        reason: { code: 'CONNECTOR_NOT_AVAILABLE', message: 'private-provider-payload' }
    }));
    const delegate = prisma.contentItem;
    const original = delegate.findFirst;
    Reflect.set(delegate, 'findFirst', async () => ({ id: 5000, project_id: 20, channel: { type: 'linkedin' } }));
    const server = Fastify();
    server.addHook('preHandler', (request, _reply, done) => { Reflect.set(request, 'projectId', 20); done(); });
    try {
        await server.register(publicationTasksRoutes);
        const response = await server.inject({ method: 'POST', url: '/api/publication-tasks/5000/publish-now' });
        assert.equal(response.statusCode, 200);
        const payload = response.json<{ result: Record<string, unknown> }>();
        assert.equal(payload.result.success, true); assert.equal(payload.result.browserRequired, true);
        assert.ok(Array.isArray(payload.result.reasons)); assert.equal(payload.result.retry_allowed, false);
        assert.ok(!JSON.stringify(payload).includes('private-provider-payload'));
    } finally { Reflect.set(delegate, 'findFirst', original); await server.close(); }
});
