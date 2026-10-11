export type ContentLanguage = 'ru' | 'en';

type ChannelLike = { config?: unknown } | null | undefined;

export function normalizeContentLanguage(value: unknown): ContentLanguage {
    return value === 'en' ? 'en' : 'ru';
}

export function channelContentLanguage(channel: ChannelLike): ContentLanguage {
    if (!channel?.config || typeof channel.config !== 'object' || Array.isArray(channel.config)) {
        return 'ru';
    }

    return normalizeContentLanguage((channel.config as Record<string, unknown>).content_language);
}

/** Resolve an explicit publication-task override before the channel generation default. */
export function publicationContentLanguage(channel: ChannelLike, taskMetadata: unknown): ContentLanguage {
    if (taskMetadata && typeof taskMetadata === 'object' && !Array.isArray(taskMetadata)) {
        const explicit = (taskMetadata as Record<string, unknown>).content_language;
        if (explicit === 'en' || explicit === 'ru') return explicit;
    }
    return channelContentLanguage(channel);
}

export function contentLanguageInstruction(language: ContentLanguage): string {
    return language === 'en'
        ? 'Write every human-readable field and the publication text in English. Keep JSON keys in English.'
        : 'Пиши все человекочитаемые поля и текст публикации на русском языке. JSON-ключи оставляй на английском.';
}
