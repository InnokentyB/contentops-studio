const X_DEFAULT_LIMIT = 280;
const X_TRANSFORMED_URL_LENGTH = 23;
const URL_PATTERN = /https?:\/\/[^\s]+/giu;

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function xCodePointWeight(codePoint: number): number {
    if ((codePoint >= 0 && codePoint <= 4351)
        || (codePoint >= 8192 && codePoint <= 8205)
        || (codePoint >= 8208 && codePoint <= 8223)
        || (codePoint >= 8242 && codePoint <= 8247)) return 1;
    return 2;
}

function weightedPlainText(text: string): number {
    return Array.from(text.normalize('NFC')).reduce((total, character) =>
        total + xCodePointWeight(character.codePointAt(0) || 0), 0);
}

/** Provider-compatible weighted length for an ordinary X post, including t.co URL transformation. */
export function measureXWeightedLength(text: string): number {
    let total = 0;
    let cursor = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
        const index = match.index || 0;
        total += weightedPlainText(text.slice(cursor, index));
        total += X_TRANSFORMED_URL_LENGTH;
        cursor = index + match[0].length;
    }
    return total + weightedPlainText(text.slice(cursor));
}

export function resolvePublicationTextLimit(channelType: string, config: unknown): number | null {
    if (!['x', 'twitter'].includes(channelType.trim().toLowerCase())) return null;
    const configured = record(config)?.x_character_limit;
    return Number.isInteger(configured) && Number(configured) > 0 && Number(configured) <= 25_000
        ? Number(configured) : X_DEFAULT_LIMIT;
}

export function assertPublicationTextWithinLimit(channelType: string, text: string, config: unknown): void {
    const limit = resolvePublicationTextLimit(channelType, config);
    if (limit === null) return;
    const weightedLength = measureXWeightedLength(text);
    if (weightedLength > limit) {
        throw new Error(`[X_TEXT_LIMIT_EXCEEDED] Weighted length ${weightedLength} exceeds limit ${limit}`);
    }
}
