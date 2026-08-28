"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptChannelSecret = encryptChannelSecret;
exports.decryptChannelSecret = decryptChannelSecret;
const crypto_1 = __importDefault(require("crypto"));
const PREFIX = 'enc:v1';
function encryptionKey() {
    const secret = process.env.CHANNEL_SECRETS_KEY?.trim();
    if (!secret) {
        throw new Error('CHANNEL_SECRETS_KEY is required to store authenticated channel sessions');
    }
    return crypto_1.default.createHash('sha256').update(secret, 'utf8').digest();
}
function encryptChannelSecret(value) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}
function decryptChannelSecret(value) {
    const [kind, version, ivEncoded, tagEncoded, encryptedEncoded] = value.split(':');
    if (`${kind}:${version}` !== PREFIX || !ivEncoded || !tagEncoded || !encryptedEncoded) {
        throw new Error('Unsupported encrypted channel secret format');
    }
    try {
        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
            decipher.final()
        ]).toString('utf8');
    }
    catch {
        throw new Error('Unable to decrypt channel session. Verify CHANNEL_SECRETS_KEY.');
    }
}
