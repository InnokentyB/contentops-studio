import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { safeEncryptProviderKey, safeDecryptProviderKey } from '../utils/channel_secrets';
import apiRoutes from '../routes/api.routes';
import authService from '../services/auth.service';
import prisma from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const TEST_SECRET_KEY = 'provider-key-test-encryption-key-32-chars-long!';

function makeToken(userId: number, email: string) {
    return jwt.sign({ id: userId, email, name: `User ${userId}` }, JWT_SECRET, { expiresIn: '1h' });
}

test('safeEncryptProviderKey and safeDecryptProviderKey handle encryption and backward compatibility', () => {
    const prevKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = TEST_SECRET_KEY;

    try {
        const rawApiKey = 'sk-ant-api03-very-secret-anthropic-key-9999';

        // 1. Encryption
        const encrypted = safeEncryptProviderKey(rawApiKey);
        assert.ok(encrypted.startsWith('enc:v1:'), 'Encrypted key must start with enc:v1:');
        assert.notEqual(encrypted, rawApiKey, 'Encrypted key must not equal raw key');

        // 2. Decryption
        const decrypted = safeDecryptProviderKey(encrypted);
        assert.equal(decrypted, rawApiKey, 'Decrypted key must match original');

        // 3. Backward compatibility with unencrypted keys
        const legacyPlaintext = 'sk-legacy-unencrypted-key-8888';
        assert.equal(safeDecryptProviderKey(legacyPlaintext), legacyPlaintext, 'Legacy unencrypted keys must be returned as is');
    } finally {
        if (prevKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = prevKey;
    }
});

test('POST /api/settings/keys encrypts key and GET /api/settings/keys masks decrypted key', async () => {
    const prevKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = TEST_SECRET_KEY;

    const app = Fastify();
    await app.register(apiRoutes);
    await app.ready();

    const origHasProjectAccess = authService.hasProjectAccess;
    authService.hasProjectAccess = async () => true;

    // Mock prisma providerKey
    let savedKeyRecord: any = null;
    const origCreate = prisma.providerKey.create;
    const origFindMany = prisma.providerKey.findMany;

    (prisma.providerKey as any).create = async ({ data }: any) => {
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

    (prisma.providerKey as any).findMany = async () => {
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

        assert.equal(createRes.statusCode, 200);
        assert.ok(savedKeyRecord !== null, 'Key record must be created');
        assert.ok(savedKeyRecord.key.startsWith('enc:v1:'), 'Stored key in DB must be encrypted with enc:v1:');
        assert.notEqual(savedKeyRecord.key, rawApiKey, 'Raw key must not be stored in plaintext');

        // 2. GET keys
        const getRes = await app.inject({
            method: 'GET',
            url: '/api/settings/keys',
            headers: {
                authorization: `Bearer ${token}`,
                'x-project-id': '10'
            }
        });

        assert.equal(getRes.statusCode, 200);
        const keys = JSON.parse(getRes.body);
        assert.equal(keys.length, 1);
        // Key mask should be based on raw key (sk-...wxyz) not (enc...xxx)
        assert.equal(keys[0].key, 'sk-...wxyz', 'GET must return masked version of decrypted key');
    } finally {
        authService.hasProjectAccess = origHasProjectAccess;
        (prisma.providerKey as any).create = origCreate;
        (prisma.providerKey as any).findMany = origFindMany;
        if (prevKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = prevKey;
    }
});
