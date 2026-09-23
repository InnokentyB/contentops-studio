import crypto from 'crypto';

const PREFIX = 'enc:v1';

export function isEncryptedChannelSecret(value: string): boolean {
    return value.startsWith(`${PREFIX}:`);
}

function encryptionKey(): Buffer {
    const secret = process.env.CHANNEL_SECRETS_KEY?.trim();
    if (!secret) {
        throw new Error('CHANNEL_SECRETS_KEY is required to store authenticated channel sessions');
    }
    if (secret.length < 32) {
        throw new Error('CHANNEL_SECRETS_KEY must contain at least 32 characters');
    }
    return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptChannelSecret(value: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptChannelSecret(value: string): string {
    const [kind, version, ivEncoded, tagEncoded, encryptedEncoded] = value.split(':');
    if (`${kind}:${version}` !== PREFIX || !ivEncoded || !tagEncoded || !encryptedEncoded) {
        throw new Error('Unsupported encrypted channel secret format');
    }

    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            encryptionKey(),
            Buffer.from(ivEncoded, 'base64url')
        );
        decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
            decipher.final()
        ]).toString('utf8');
    } catch {
        throw new Error('Unable to decrypt channel session. Verify CHANNEL_SECRETS_KEY.');
    }
}

/**
 * Safely encrypts a provider API key before writing to persistent storage.
 * If CHANNEL_SECRETS_KEY is defined (>= 32 chars), returns the AES-256-GCM ciphertext prefixed with enc:v1:.
 * If the key is already encrypted or CHANNEL_SECRETS_KEY is missing, returns the input key.
 *
 * @param key The plain or already-encrypted API key string.
 * @returns The encrypted string if encryption key is present, otherwise original key.
 */
export function safeEncryptProviderKey(key: string): string {
    if (!key || typeof key !== 'string') return '';
    const secret = process.env.CHANNEL_SECRETS_KEY?.trim();
    if (!secret || secret.length < 32) {
        return key;
    }
    if (isEncryptedChannelSecret(key)) {
        return key;
    }
    return encryptChannelSecret(key);
}

/**
 * Safely decrypts a provider API key from persistent storage.
 * If the key is encrypted (starts with enc:v1:), decrypts via AES-256-GCM using CHANNEL_SECRETS_KEY.
 * If the key is in plaintext (legacy record), returns it directly.
 *
 * @param key The stored key string.
 * @returns The decrypted plaintext API key string.
 */
export function safeDecryptProviderKey(key: string): string {
    if (!key || typeof key !== 'string') return '';
    if (isEncryptedChannelSecret(key)) {
        return decryptChannelSecret(key);
    }
    return key;
}

