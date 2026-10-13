import { Api } from 'telegram/tl';
import type { TelegramStoryNativeLink } from './telegram_task1100_story_sequence';

export function buildTelegramStoryMediaAreas(nativeLink?: TelegramStoryNativeLink): Api.TypeMediaArea[] | undefined {
    if (!nativeLink) return undefined;
    let parsed: URL;
    try { parsed = new URL(nativeLink.url); } catch {
        throw new Error('[TELEGRAM_STORY_LINK_INVALID] Native Story link must be a valid HTTPS URL');
    }
    const { canvasWidth, canvasHeight, centerX, centerY, width, height } = nativeLink;
    if (parsed.protocol !== 'https:' || !nativeLink.label.trim()
        || ![canvasWidth, canvasHeight, centerX, centerY, width, height].every(Number.isFinite)
        || canvasWidth <= 0 || canvasHeight <= 0 || width <= 0 || height <= 0
        || centerX - width / 2 < 0 || centerX + width / 2 > canvasWidth
        || centerY - height / 2 < 0 || centerY + height / 2 > canvasHeight) {
        throw new Error('[TELEGRAM_STORY_LINK_INVALID] Native Story link area is outside the approved canvas');
    }
    return [new Api.MediaAreaUrl({
        coordinates: new Api.MediaAreaCoordinates({
            x: centerX / canvasWidth * 100, y: centerY / canvasHeight * 100,
            w: width / canvasWidth * 100, h: height / canvasHeight * 100,
            rotation: 0, radius: 4
        }),
        url: parsed.toString()
    })];
}
