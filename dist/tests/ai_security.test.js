"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fastify_1 = __importDefault(require("fastify"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const path_safety_1 = require("../utils/path_safety");
const api_routes_1 = __importDefault(require("../routes/api.routes"));
const auth_service_1 = __importDefault(require("../services/auth.service"));
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
function makeToken(userId, email) {
    return jsonwebtoken_1.default.sign({ id: userId, email, name: `User ${userId}` }, JWT_SECRET, { expiresIn: '1h' });
}
(0, node_test_1.default)('safeResolveUploadPath neutralizes directory traversal attempts', () => {
    // 1. Directory traversal using ../
    const traversalAttempt1 = (0, path_safety_1.safeResolveUploadPath)('../../.env');
    strict_1.default.equal(traversalAttempt1, null, 'Must reject directory traversal ../../.env');
    // 2. Traversal within pseudo path
    const traversalAttempt2 = (0, path_safety_1.safeResolveUploadPath)('uploads/../../../etc/passwd');
    strict_1.default.equal(traversalAttempt2, null, 'Must reject nested traversal');
    // 3. Absolute path injection
    const traversalAttempt3 = (0, path_safety_1.safeResolveUploadPath)('/etc/shadow');
    strict_1.default.equal(traversalAttempt3, null, 'Must reject absolute path targeting outside uploads');
    // 4. Valid filename
    const validResult = (0, path_safety_1.safeResolveUploadPath)('post-123-image.png');
    strict_1.default.ok(validResult !== null, 'Valid filename must resolve successfully');
    strict_1.default.ok(validResult.endsWith('post-123-image.png'), 'Must resolve to the sanitized filename');
});
(0, node_test_1.default)('POST /api/v2/strategy-chat enforces message length limits (DoS & Token Inflation prevention)', async () => {
    const app = (0, fastify_1.default)();
    await app.register(api_routes_1.default);
    await app.ready();
    const origHasProjectAccess = auth_service_1.default.hasProjectAccess;
    auth_service_1.default.hasProjectAccess = async () => true;
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
        strict_1.default.equal(resOversized.statusCode, 400, 'Payload exceeding limit must be rejected with 400');
        const bodyOversized = JSON.parse(resOversized.body);
        strict_1.default.match(bodyOversized.error, /exceeds maximum length/i);
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
        strict_1.default.equal(resEmpty.statusCode, 400, 'Empty message must return 400');
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
        strict_1.default.equal(resNonString.statusCode, 400, 'Non-string message must return 400');
    }
    finally {
        auth_service_1.default.hasProjectAccess = origHasProjectAccess;
    }
});
