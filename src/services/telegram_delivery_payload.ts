export type TelegramDeliveryPayload = {
    text: string;
    imageUrl: string | null;
};

export function normalizeTelegramDeliveryPayload(input: {
    text: unknown;
    imageUrl?: unknown;
}): TelegramDeliveryPayload {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) {
        throw new Error('[TELEGRAM_TEXT_REQUIRED] Telegram publication text must not be empty');
    }

    const imageUrl = typeof input.imageUrl === 'string' && input.imageUrl.trim()
        ? input.imageUrl.trim()
        : null;

    return { text, imageUrl };
}

export function buildTelegramDeliveryPreview(payload: TelegramDeliveryPayload) {
    return {
        text: payload.text,
        image_url: payload.imageUrl,
        has_image: Boolean(payload.imageUrl)
    };
}
