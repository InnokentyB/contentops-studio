"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeContentLanguage = normalizeContentLanguage;
exports.channelContentLanguage = channelContentLanguage;
exports.contentLanguageInstruction = contentLanguageInstruction;
function normalizeContentLanguage(value) {
    return value === 'en' ? 'en' : 'ru';
}
function channelContentLanguage(channel) {
    if (!channel?.config || typeof channel.config !== 'object' || Array.isArray(channel.config)) {
        return 'ru';
    }
    return normalizeContentLanguage(channel.config.content_language);
}
function contentLanguageInstruction(language) {
    return language === 'en'
        ? 'Write every human-readable field and the publication text in English. Keep JSON keys in English.'
        : 'Пиши все человекочитаемые поля и текст публикации на русском языке. JSON-ключи оставляй на английском.';
}
