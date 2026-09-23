import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import apiRoutes from '../routes/api.routes';
import jobRoutes from '../routes/jobs';
import authService from '../services/auth.service';
import prisma from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function makeToken(userId: number, email: string) {
    return jwt.sign({ id: userId, email, name: `User ${userId}` }, JWT_SECRET, { expiresIn: '1h' });
}

test('POST /jobs/publish-due rejects unauthenticated requests with 401', async () => {
    process.env.INTERNAL_JOB_SECRET = 'test-job-secret-12345';
    const app = Fastify();
    await app.register(jobRoutes);
    await app.ready();

    // 1. Without secret
    const resNoAuth = await app.inject({
        method: 'POST',
        url: '/jobs/publish-due'
    });
    assert.equal(resNoAuth.statusCode, 401, 'Unauthenticated job trigger must be rejected with 401');

    // 2. With invalid secret
    const resBadAuth = await app.inject({
        method: 'POST',
        url: '/jobs/publish-due',
        headers: { 'x-job-secret': 'wrong-secret' }
    });
    assert.equal(resBadAuth.statusCode, 401, 'Invalid secret must be rejected with 401');

    delete process.env.INTERNAL_JOB_SECRET;
});

test('GET /api/posts/:id rejects access when user does not belong to post project', async () => {
    const app = Fastify();
    await app.register(apiRoutes);
    await app.ready();

    // Mock prisma and authService for this test
    const origFindUnique = prisma.post.findUnique;
    const origHasProjectAccess = authService.hasProjectAccess;

    try {
        // Post 999 belongs to project 200
        (prisma.post as any).findUnique = async () => ({
            id: 999,
            project_id: 200,
            topic: 'Secret project B post',
            status: 'draft'
        });

        // User 1 only has access to project 100, NOT 200
        authService.hasProjectAccess = async (userId: number, projectId: number) => {
            return userId === 1 && projectId === 100;
        };

        const tokenUser1 = makeToken(1, 'user1@example.com');

        // User 1 attempts to read Post 999 (which belongs to project 200)
        const res = await app.inject({
            method: 'GET',
            url: '/api/posts/999',
            headers: {
                Authorization: `Bearer ${tokenUser1}`,
                'x-project-id': '100'
            }
        });

        // Must NOT return 200 with post data
        assert.notEqual(res.statusCode, 200, 'Cross-tenant post read must not succeed with 200');
        assert.ok([403, 404].includes(res.statusCode), `Expected 403 or 404, got ${res.statusCode}`);
    } finally {
        prisma.post.findUnique = origFindUnique;
        authService.hasProjectAccess = origHasProjectAccess;
    }
});

test('PUT /api/posts/:id rejects cross-tenant modification', async () => {
    const app = Fastify();
    await app.register(apiRoutes);
    await app.ready();

    const origFindUnique = prisma.post.findUnique;
    const origUpdate = prisma.post.update;
    const origHasProjectAccess = authService.hasProjectAccess;

    try {
        (prisma.post as any).findUnique = async () => ({
            id: 999,
            project_id: 200,
            topic: 'Secret project B post'
        });

        let updatedCalled = false;
        (prisma.post as any).update = async () => {
            updatedCalled = true;
            return { id: 999 };
        };

        authService.hasProjectAccess = async (userId: number, projectId: number) => {
            return userId === 1 && projectId === 100;
        };

        const tokenUser1 = makeToken(1, 'user1@example.com');

        const res = await app.inject({
            method: 'PUT',
            url: '/api/posts/999',
            headers: {
                Authorization: `Bearer ${tokenUser1}`,
                'x-project-id': '100'
            },
            payload: { topic: 'Overwritten by attacker' }
        });

        assert.equal(updatedCalled, false, 'Prisma.update must not be called for unauthorized post');
        assert.ok([403, 404].includes(res.statusCode), `Expected 403 or 404, got ${res.statusCode}`);
    } finally {
        prisma.post.findUnique = origFindUnique;
        prisma.post.update = origUpdate;
        authService.hasProjectAccess = origHasProjectAccess;
    }
});

test('DELETE /api/weeks/:id rejects cross-tenant deletion', async () => {
    const app = Fastify();
    await app.register(apiRoutes);
    await app.ready();

    const origFindUnique = prisma.week.findUnique;
    const origDelete = prisma.week.delete;
    const origHasProjectAccess = authService.hasProjectAccess;

    try {
        (prisma.week as any).findUnique = async () => ({
            id: 777,
            project_id: 200
        });

        let deleteCalled = false;
        (prisma.week as any).delete = async () => {
            deleteCalled = true;
            return { id: 777 };
        };

        authService.hasProjectAccess = async (userId: number, projectId: number) => {
            return userId === 1 && projectId === 100;
        };

        const tokenUser1 = makeToken(1, 'user1@example.com');

        const res = await app.inject({
            method: 'DELETE',
            url: '/api/weeks/777',
            headers: {
                Authorization: `Bearer ${tokenUser1}`
            }
        });

        assert.equal(deleteCalled, false, 'Prisma.week.delete must not be called for unauthorized week');
        assert.ok([403, 404].includes(res.statusCode), `Expected 403 or 404, got ${res.statusCode}`);
    } finally {
        prisma.week.findUnique = origFindUnique;
        prisma.week.delete = origDelete;
        authService.hasProjectAccess = origHasProjectAccess;
    }
});
