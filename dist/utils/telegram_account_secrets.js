"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptTelegramAccountSecrets = encryptTelegramAccountSecrets;
exports.decryptTelegramAccountSecrets = decryptTelegramAccountSecrets;
exports.telegramAccountSecretsAreEncrypted = telegramAccountSecretsAreEncrypted;
exports.telegramPhoneHint = telegramPhoneHint;
const channel_secrets_1 = require("./channel_secrets");
function requiredSecret(value, label) {
    const normalized = value.trim();
    if (!normalized)
        throw new Error(`${label} is required`);
    return normalized;
}
function encryptTelegramAccountSecrets(apiHash, sessionString) {
    return {
        api_hash: (0, channel_secrets_1.encryptChannelSecret)(requiredSecret(apiHash, 'Telegram API hash')),
        session_string: (0, channel_secrets_1.encryptChannelSecret)(requiredSecret(sessionString, 'Telegram session'))
    };
}
function decryptTelegramAccountSecrets(stored) {
    return {
        api_hash: (0, channel_secrets_1.isEncryptedChannelSecret)(stored.api_hash)
            ? (0, channel_secrets_1.decryptChannelSecret)(stored.api_hash)
            : stored.api_hash,
        session_string: (0, channel_secrets_1.isEncryptedChannelSecret)(stored.session_string)
            ? (0, channel_secrets_1.decryptChannelSecret)(stored.session_string)
            : stored.session_string
    };
}
function telegramAccountSecretsAreEncrypted(stored) {
    return (0, channel_secrets_1.isEncryptedChannelSecret)(stored.api_hash)
        && (0, channel_secrets_1.isEncryptedChannelSecret)(stored.session_string);
}
function telegramPhoneHint(phoneNumber) {
    const digits = phoneNumber.replace(/\D/g, '');
    return digits ? `***${digits.slice(-4)}` : '***';
}
