"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fastify_1 = __importDefault(require("fastify"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const channel_secrets_1 = require("../utils/channel_secrets");
const api_routes_1 = __importDefault(require("../routes/api.routes"));
const auth_service_1 = __importDefault(require("../services/auth.service"));
const db_1 = __importDefault(require("../db"));
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TEST_SECRET_KEY = 'provider-key-test-encryption-key-32-chars-long!';
function makeToken(userId, email) {
    return jsonwebtoken_1.default.sign({ id: userId, email, name: `User ${userId}` }, JWT_SECRET, { expiresIn: '1h' });
}
(0, node_test_1.default)('safeEncryptProviderKey and safeDecryptProviderKey handle encryption and backward compatibility', () => {
    const prevKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = TEST_SECRET_KEY;
    try {
        const rawApiKey = 'sk-ant-api03-very-secret-anthropic-key-9999';
        // 1. Encryption
        const encrypted = (0, channel_secrets_1.safeEncryptProviderKey)(rawApiKey);
        strict_1.default.ok(encrypted.startsWith('enc:v1:'), 'Encrypted key must start with enc:v1:');
        strict_1.default.notEqual(encrypted, rawApiKey, 'Encrypted key must not equal raw key');
        // 2. Decryption
        const decrypted = (0, channel_secrets_1.safeDecryptProviderKey)(encrypted);
        strict_1.default.equal(decrypted, rawApiKey, 'Decrypted key must match original');
        // 3. Backward compatibility with unencrypted keys
        const legacyPlaintext = 'sk-legacy-unencrypted-key-8888';
        strict_1.default.equal((0, channel_secrets_1.safeDecryptProviderKey)(legacyPlaintext), legacyPlaintext, 'Legacy unencrypted keys must be returned as is');
    }
    finally {
        if (prevKey === undefined)
            delete process.env.CHANNEL_SECRETS_KEY;
        else
            process.env.CHANNEL_SECRETS_KEY = prevKey;
    }
});
(0, node_test_1.default)('POST /api/settings/keys encrypts key and GET /api/settings/keys masks decrypted key', async () => {
    const prevKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = TEST_SECRET_KEY;
    const app = (0, fastify_1.default)();
    await app.register(api_routes_1.default);
    await app.ready();
    const origHasProjectAccess = auth_service_1.default.hasProjectAccess;
    auth_service_1.default.hasProjectAccess = async () => true;
    // Mock prisma providerKey
    let savedKeyRecord = null;
    const origCreate = db_1.default.providerKey.create;
    const origFindMany = db_1.default.providerKey.findMany;
    db_1.default.providerKey.create = async ({ data }) => {
        savedKeyRecord = {
            id: 42,
            project_id: data.project_id,
            name: data.name,
            key: data.key,
            provider: data.provider,
            created_at: new Date()
        };
        return savedKeyRecord;
    };
    db_1.default.providerKey.findMany = async () => {
        return savedKeyRecord ? [savedKeyRecord] : [];
    };
    try {
        const token = makeToken(1, 'tester@example.com');
        const rawApiKey = 'sk-1234567890abcdefghijklmnopqrstuvwxyz';
        // 1. POST new key
        const createRes = await app.inject({
            method: 'POST',
            url: '/api/settings/keys',
            headers: {
                authorization: `Bearer ${token}`,
                'x-project-id': '10'
            },
            payload: {
                name: 'Production OpenAI',
                key: rawApiKey
            }
        });
        strict_1.default.equal(createRes.statusCode, 200);
        strict_1.default.ok(savedKeyRecord !== null, 'Key record must be created');
        strict_1.default.ok(savedKeyRecord.key.startsWith('enc:v1:'), 'Stored key in DB must be encrypted with enc:v1:');
        strict_1.default.notEqual(savedKeyRecord.key, rawApiKey, 'Raw key must not be stored in plaintext');
        // 2. GET keys
        const getRes = await app.inject({
            method: 'GET',
            url: '/api/settings/keys',
            headers: {
                authorization: `Bearer ${token}`,
                'x-project-id': '10'
            }
        });
        strict_1.default.equal(getRes.statusCode, 200);
        const keys = JSON.parse(getRes.body);
        strict_1.default.equal(keys.length, 1);
        // Key mask should be based on raw key (sk-...wxyz) not (enc...xxx)
        strict_1.default.equal(keys[0].key, 'sk-...wxyz', 'GET must return masked version of decrypted key');
    }
    finally {
        auth_service_1.default.hasProjectAccess = origHasProjectAccess;
        db_1.default.providerKey.create = origCreate;
        db_1.default.providerKey.findMany = origFindMany;
        if (prevKey === undefined)
            delete process.env.CHANNEL_SECRETS_KEY;
        else
            process.env.CHANNEL_SECRETS_KEY = prevKey;
    }
});
