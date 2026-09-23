import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { safeResolveUploadPath } from '../utils/path_safety';
import apiRoutes from '../routes/api.routes';
import authService from '../services/auth.service';
import prisma from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function makeToken(userId: number, email: string) {
    return jwt.sign({ id: userId, email, name: `User ${userId}` }, JWT_SECRET, { expiresIn: '1h' });
}

test('safeResolveUploadPath neutralizes directory traversal attempts', () => {
    // 1. Directory traversal using ../
    const traversalAttempt1 = safeResolveUploadPath('../../.env');
    assert.equal(traversalAttempt1, null, 'Must reject directory traversal ../../.env');

    // 2. Traversal within pseudo path
    const traversalAttempt2 = safeResolveUploadPath('uploads/../../../etc/passwd');
    assert.equal(traversalAttempt2, null, 'Must reject nested traversal');

    // 3. Absolute path injection
    const traversalAttempt3 = safeResolveUploadPath('/etc/shadow');
    assert.equal(traversalAttempt3, null, 'Must reject absolute path targeting outside uploads');

    // 4. Valid filename
    const validResult = safeResolveUploadPath('post-123-image.png');
    assert.ok(validResult !== null, 'Valid filename must resolve successfully');
    assert.ok(validResult.endsWith('post-123-image.png'), 'Must resolve to the sanitized filename');
});

test('POST /api/v2/strategy-chat enforces message length limits (DoS & Token Inflation prevention)', async () => {
    const app = Fastify();
    await app.register(apiRoutes);
    await app.ready();

    const origHasProjectAccess = authService.hasProjectAccess;
    authService.hasProjectAccess = async () => true;

    try {
        const token = makeToken(1, 'tester@example.com');

        // 1. Oversized message (e.g. 5000 characters)
        const hugeMessage = 'A'.repeat(5000);
        const resOversized = await app.inject({
            method: 'POST',
            url: '/api/v2/strategy-chat',
            headers: {
                authorization: `Bearer ${token}`,
                'x-project-id': '100'
            },
            payload: {
                message: hugeMessage
            }
        });

        assert.equal(resOversized.statusCode, 400, 'Payload exceeding limit must be rejected with 400');
        const bodyOversized = JSON.parse(resOversized.body);
        assert.match(bodyOversized.error, /exceeds maximum length/i);

        // 2. Missing or empty message
        const resEmpty = await app.inject({
            method: 'POST',
            url: '/api/v2/strategy-chat',
            headers: {
                authorization: `Bearer ${token}`,
                'x-project-id': '100'
            },
            payload: {
                message: '   '
            }
        });

        assert.equal(resEmpty.statusCode, 400, 'Empty message must return 400');

        // 3. Non-string message
        const resNonString = await app.inject({
            method: 'POST',
            url: '/api/v2/strategy-chat',
            headers: {
                authorization: `Bearer ${token}`,
                'x-project-id': '100'
            },
            payload: {
                message: 12345
            }
        });

        assert.equal(resNonString.statusCode, 400, 'Non-string message must return 400');
    } finally {
        authService.hasProjectAccess = origHasProjectAccess;
    }
});
