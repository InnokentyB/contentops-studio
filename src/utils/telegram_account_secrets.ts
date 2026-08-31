import {
    decryptChannelSecret,
    encryptChannelSecret,
    isEncryptedChannelSecret
} from './channel_secrets';

type StoredTelegramSecrets = {
    api_hash: string;
    session_string: string;
};

function requiredSecret(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} is required`);
    return normalized;
}

export function encryptTelegramAccountSecrets(apiHash: string, sessionString: string): StoredTelegramSecrets {
    return {
        api_hash: encryptChannelSecret(requiredSecret(apiHash, 'Telegram API hash')),
        session_string: encryptChannelSecret(requiredSecret(sessionString, 'Telegram session'))
    };
}

export function decryptTelegramAccountSecrets(stored: StoredTelegramSecrets): StoredTelegramSecrets {
    return {
        api_hash: isEncryptedChannelSecret(stored.api_hash)
            ? decryptChannelSecret(stored.api_hash)
            : stored.api_hash,
        session_string: isEncryptedChannelSecret(stored.session_string)
            ? decryptChannelSecret(stored.session_string)
            : stored.session_string
    };
}

export function telegramAccountSecretsAreEncrypted(stored: StoredTelegramSecrets): boolean {
    return isEncryptedChannelSecret(stored.api_hash)
        && isEncryptedChannelSecret(stored.session_string);
}
