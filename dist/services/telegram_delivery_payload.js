"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTelegramDeliveryPayload = normalizeTelegramDeliveryPayload;
exports.buildTelegramDeliveryPreview = buildTelegramDeliveryPreview;
function normalizeTelegramDeliveryPayload(input) {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) {
        throw new Error('[TELEGRAM_TEXT_REQUIRED] Telegram publication text must not be empty');
    }
    const imageUrl = typeof input.imageUrl === 'string' && input.imageUrl.trim()
        ? input.imageUrl.trim()
        : null;
    return { text, imageUrl };
}
function buildTelegramDeliveryPreview(payload) {
    return {
        text: payload.text,
        image_url: payload.imageUrl,
        has_image: Boolean(payload.imageUrl)
    };
}
