"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fastify_1 = __importDefault(require("fastify"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const api_routes_1 = __importDefault(require("../routes/api.routes"));
const jobs_1 = __importDefault(require("../routes/jobs"));
const auth_service_1 = __importDefault(require("../services/auth.service"));
const db_1 = __importDefault(require("../db"));
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
function makeToken(userId, email) {
    return jsonwebtoken_1.default.sign({ id: userId, email, name: `User ${userId}` }, JWT_SECRET, { expiresIn: '1h' });
}
(0, node_test_1.default)('POST /jobs/publish-due rejects unauthenticated requests with 401', async () => {
    process.env.INTERNAL_JOB_SECRET = 'test-job-secret-12345';
    const app = (0, fastify_1.default)();
    await app.register(jobs_1.default);
    await app.ready();
    // 1. Without secret
    const resNoAuth = await app.inject({
        method: 'POST',
        url: '/jobs/publish-due'
    });
    strict_1.default.equal(resNoAuth.statusCode, 401, 'Unauthenticated job trigger must be rejected with 401');
    // 2. With invalid secret
    const resBadAuth = await app.inject({
        method: 'POST',
        url: '/jobs/publish-due',
        headers: { 'x-job-secret': 'wrong-secret' }
    });
    strict_1.default.equal(resBadAuth.statusCode, 401, 'Invalid secret must be rejected with 401');
    delete process.env.INTERNAL_JOB_SECRET;
});
(0, node_test_1.default)('GET /api/posts/:id rejects access when user does not belong to post project', async () => {
    const app = (0, fastify_1.default)();
    await app.register(api_routes_1.default);
    await app.ready();
    // Mock prisma and authService for this test
    const origFindUnique = db_1.default.post.findUnique;
    const origHasProjectAccess = auth_service_1.default.hasProjectAccess;
    try {
        // Post 999 belongs to project 200
        db_1.default.post.findUnique = async () => ({
            id: 999,
            project_id: 200,
            topic: 'Secret project B post',
            status: 'draft'
        });
        // User 1 only has access to project 100, NOT 200
        auth_service_1.default.hasProjectAccess = async (userId, projectId) => {
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
        strict_1.default.notEqual(res.statusCode, 200, 'Cross-tenant post read must not succeed with 200');
        strict_1.default.ok([403, 404].includes(res.statusCode), `Expected 403 or 404, got ${res.statusCode}`);
    }
    finally {
        db_1.default.post.findUnique = origFindUnique;
        auth_service_1.default.hasProjectAccess = origHasProjectAccess;
    }
});
(0, node_test_1.default)('PUT /api/posts/:id rejects cross-tenant modification', async () => {
    const app = (0, fastify_1.default)();
    await app.register(api_routes_1.default);
    await app.ready();
    const origFindUnique = db_1.default.post.findUnique;
    const origUpdate = db_1.default.post.update;
    const origHasProjectAccess = auth_service_1.default.hasProjectAccess;
    try {
        db_1.default.post.findUnique = async () => ({
            id: 999,
            project_id: 200,
            topic: 'Secret project B post'
        });
        let updatedCalled = false;
        db_1.default.post.update = async () => {
            updatedCalled = true;
            return { id: 999 };
        };
        auth_service_1.default.hasProjectAccess = async (userId, projectId) => {
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
        strict_1.default.equal(updatedCalled, false, 'Prisma.update must not be called for unauthorized post');
        strict_1.default.ok([403, 404].includes(res.statusCode), `Expected 403 or 404, got ${res.statusCode}`);
    }
    finally {
        db_1.default.post.findUnique = origFindUnique;
        db_1.default.post.update = origUpdate;
        auth_service_1.default.hasProjectAccess = origHasProjectAccess;
    }
});
(0, node_test_1.default)('DELETE /api/weeks/:id rejects cross-tenant deletion', async () => {
    const app = (0, fastify_1.default)();
    await app.register(api_routes_1.default);
    await app.ready();
    const origFindUnique = db_1.default.week.findUnique;
    const origDelete = db_1.default.week.delete;
    const origHasProjectAccess = auth_service_1.default.hasProjectAccess;
    try {
        db_1.default.week.findUnique = async () => ({
            id: 777,
            project_id: 200
        });
        let deleteCalled = false;
        db_1.default.week.delete = async () => {
            deleteCalled = true;
            return { id: 777 };
        };
        auth_service_1.default.hasProjectAccess = async (userId, projectId) => {
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
        strict_1.default.equal(deleteCalled, false, 'Prisma.week.delete must not be called for unauthorized week');
        strict_1.default.ok([403, 404].includes(res.statusCode), `Expected 403 or 404, got ${res.statusCode}`);
    }
    finally {
        db_1.default.week.findUnique = origFindUnique;
        db_1.default.week.delete = origDelete;
        auth_service_1.default.hasProjectAccess = origHasProjectAccess;
    }
});
