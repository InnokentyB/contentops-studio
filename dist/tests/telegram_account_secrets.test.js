"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const telegram_account_secrets_1 = require("../utils/telegram_account_secrets");
(0, node_test_1.default)('Telegram API hash and session are encrypted at rest', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'test-only-telegram-secret-key-with-32-chars';
    try {
        const stored = (0, telegram_account_secrets_1.encryptTelegramAccountSecrets)('api-hash-secret', 'session-string-secret');
        strict_1.default.equal((0, telegram_account_secrets_1.telegramAccountSecretsAreEncrypted)(stored), true);
        strict_1.default.match(stored.api_hash, /^enc:v1:/);
        strict_1.default.match(stored.session_string, /^enc:v1:/);
        strict_1.default.equal(JSON.stringify(stored).includes('api-hash-secret'), false);
        strict_1.default.equal(JSON.stringify(stored).includes('session-string-secret'), false);
        strict_1.default.deepEqual((0, telegram_account_secrets_1.decryptTelegramAccountSecrets)(stored), {
            api_hash: 'api-hash-secret',
            session_string: 'session-string-secret'
        });
    }
    finally {
        if (previousKey === undefined)
            delete process.env.CHANNEL_SECRETS_KEY;
        else
            process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});
(0, node_test_1.default)('legacy Telegram secrets remain readable during the encryption rollout', () => {
    const legacy = { api_hash: 'legacy-hash', session_string: 'legacy-session' };
    strict_1.default.equal((0, telegram_account_secrets_1.telegramAccountSecretsAreEncrypted)(legacy), false);
    strict_1.default.deepEqual((0, telegram_account_secrets_1.decryptTelegramAccountSecrets)(legacy), legacy);
});
(0, node_test_1.default)('Telegram secret encryption rejects a weak Railway key', () => {
    const previousKey = process.env.CHANNEL_SECRETS_KEY;
    process.env.CHANNEL_SECRETS_KEY = 'too-short';
    try {
        strict_1.default.throws(() => (0, telegram_account_secrets_1.encryptTelegramAccountSecrets)('api-hash', 'session'), /at least 32 characters/);
    }
    finally {
        if (previousKey === undefined)
            delete process.env.CHANNEL_SECRETS_KEY;
        else
            process.env.CHANNEL_SECRETS_KEY = previousKey;
    }
});
(0, node_test_1.default)('Telegram phone hints never expose the full account number', () => {
    strict_1.default.equal((0, telegram_account_secrets_1.telegramPhoneHint)('+351 929 042 849'), '***2849');
    strict_1.default.equal((0, telegram_account_secrets_1.telegramPhoneHint)(''), '***');
});
