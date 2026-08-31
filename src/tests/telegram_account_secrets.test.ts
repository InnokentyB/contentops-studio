import test from 'node:test';
import assert from 'node:assert/strict';
import {
    decryptTelegramAccountSecrets,
    encryptTelegramAccountSecrets,
    telegramAccountSecretsAreEncrypted,
    telegramPhoneHint
} from '../utils/telegram_account_secrets';

test('Telegram API hash and session are encrypted at rest', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-only-telegram-secret-key-with-32-chars';
    try {
        const stored = encryptTelegramAccountSecrets('api-hash-secret', 'session-string-secret');
        assert.equal(telegramAccountSecretsAreEncrypted(stored), true);
        assert.match(stored.api_hash, /^enc:v1:/);
        assert.match(stored.session_string, /^enc:v1:/);
        assert.equal(JSON.stringify(stored).includes('api-hash-secret'), false);
        assert.equal(JSON.stringify(stored).includes('session-string-secret'), false);
        assert.deepEqual(decryptTelegramAccountSecrets(stored), {
            api_hash: 'api-hash-secret',
            session_string: 'session-string-secret'
        });
    } finally {
        if (previousKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});

test('legacy Telegram secrets remain readable during the encryption rollout', () => {
    const legacy = { api_hash: 'legacy-hash', session_string: 'legacy-session' };
    assert.equal(telegramAccountSecretsAreEncrypted(legacy), false);
    assert.deepEqual(decryptTelegramAccountSecrets(legacy), legacy);
});

test('Telegram secret encryption rejects a weak Railway key', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'too-short';
    try {
        assert.throws(
            () => encryptTelegramAccountSecrets('api-hash', 'session'),
            /at least 32 characters/
        );
    } finally {
        if (previousKey === undefined) delete process.env.CHANNEL_SECRETS_KEY;
        else process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});

test('Telegram phone hints never expose the full account number', () => {
    assert.equal(telegramPhoneHint('+351 929 042 849'), '***2849');
    assert.equal(telegramPhoneHint(''), '***');
});
