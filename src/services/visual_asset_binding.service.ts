import { createHash } from 'crypto';

const MAX_VISUAL_BYTES = 10 * 1024 * 1024;
const MANAGED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export type VisualBinaryMetadata = {
    sha256: string;
    mime_type: string;
    byte_size: number;
    width: number | null;
    height: number | null;
    color_mode: string | null;
};

export function isServerResolvableVisualUrl(value?: string | null) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === 'https:'
            && !['localhost', '0.0.0.0', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function pngMetadata(buffer: Buffer) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 26 || !buffer.subarray(0, 8).equals(signature)) return null;
    const colorTypes: Record<number, string> = { 0: 'GRAYSCALE', 2: 'RGB', 3: 'INDEXED', 4: 'GRAYSCALE_ALPHA', 6: 'RGBA' };
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorMode: colorTypes[buffer[25]] || 'UNKNOWN' };
}

function gifMetadata(buffer: Buffer) {
    const signature = buffer.subarray(0, 6).toString('ascii');
    if (buffer.length < 10 || !['GIF87a', 'GIF89a'].includes(signature)) return null;
    return { mimeType: 'image/gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), colorMode: 'INDEXED' };
}

function jpegMetadata(buffer: Buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
            const components = buffer[offset + 9];
            return { mimeType: 'image/jpeg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), colorMode: components === 1 ? 'GRAYSCALE' : components === 3 ? 'RGB' : 'CMYK' };
        }
        if (offset + 4 > buffer.length) break;
        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2) break;
        offset += segmentLength + 2;
    }
    return null;
}

function webpMetadata(buffer: Buffer) {
    if (buffer.length < 30 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
    const kind = buffer.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X') {
        return { mimeType: 'image/webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3), colorMode: 'RGB' };
    }
    return { mimeType: 'image/webp', width: null, height: null, colorMode: 'RGB' };
}

export function inspectVisualBinary(buffer: Buffer, declaredMimeType?: string | null): VisualBinaryMetadata {
    if (!buffer.length) throw new Error('[VISUAL_SOURCE_EMPTY] Visual source is empty');
    if (buffer.length > MAX_VISUAL_BYTES) throw new Error('[VISUAL_SOURCE_TOO_LARGE] Visual source exceeds 10 MB');
    const detected = pngMetadata(buffer) || jpegMetadata(buffer) || gifMetadata(buffer) || webpMetadata(buffer);
    if (!detected || !MANAGED_MIME_TYPES.has(detected.mimeType)) {
        throw new Error('[VISUAL_SOURCE_TYPE_UNSUPPORTED] Only PNG, JPEG, GIF and WebP images are supported');
    }
    const declared = declaredMimeType?.split(';')[0].trim().toLowerCase();
    if (declared && declared !== detected.mimeType) {
        throw new Error('[VISUAL_SOURCE_MIME_MISMATCH] Declared MIME type does not match the file');
    }
    return {
        sha256: createHash('sha256').update(buffer).digest('hex'),
        mime_type: detected.mimeType,
        byte_size: buffer.length,
        width: detected.width,
        height: detected.height,
        color_mode: detected.colorMode
    };
}

export function decodeVisualBase64(value: string) {
    const normalized = value.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        throw new Error('[VISUAL_SOURCE_BASE64_INVALID] Visual source must contain valid base64 data');
    }
    return Buffer.from(normalized, 'base64');
}

export function visualMetadataFromProvenance(provenance: unknown): Partial<VisualBinaryMetadata> {
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return {};
    const storage = (provenance as any).planner_storage;
    return storage && typeof storage === 'object' ? storage : {};
}

