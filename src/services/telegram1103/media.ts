import { isIP } from 'node:net';
import { CustomFile } from 'telegram/client/uploads';
import { TG1103, videoHash } from './contract';
export type Video1103Metadata = { width: number; height: number; duration: number };
type Atom = { kind: string; bytes: Buffer };
function atoms(bytes: Buffer): Atom[] {
    const result: Atom[] = []; let offset = 0;
    while (offset < bytes.length) {
        if (offset + 8 > bytes.length) throw new Error('[TELEGRAM_VIDEO_METADATA_INVALID]');
        const size = bytes.readUInt32BE(offset);
        if (size < 8 || offset + size > bytes.length) throw new Error('[TELEGRAM_VIDEO_METADATA_INVALID]');
        result.push({ kind: bytes.subarray(offset + 4, offset + 8).toString('ascii'), bytes: bytes.subarray(offset + 8, offset + size) });
        offset += size;
    }
    return result;
}
/** Read ISO-BMFF video-track geometry/duration; never substitute guessed dimensions. */
export function inspectVideo1103Metadata(buffer: Buffer): Video1103Metadata {
    const moov = atoms(buffer).find(a => a.kind === 'moov');
    if (moov) for (const track of atoms(moov.bytes).filter(a => a.kind === 'trak')) {
        const entries = atoms(track.bytes), mdia = entries.find(a => a.kind === 'mdia');
        if (!mdia) continue;
        const media = atoms(mdia.bytes), handler = media.find(a => a.kind === 'hdlr');
        if (handler?.bytes.subarray(8, 12).toString('ascii') !== 'vide') continue;
        const tkhd = entries.find(a => a.kind === 'tkhd')?.bytes, mdhd = media.find(a => a.kind === 'mdhd')?.bytes;
        if (!tkhd || tkhd.length < 84 || !mdhd || mdhd.length < 24) break;
        const width = tkhd.readUInt32BE(tkhd.length - 8) / 65536, height = tkhd.readUInt32BE(tkhd.length - 4) / 65536;
        const v1 = mdhd[0] === 1;
        if (v1 && mdhd.length < 32) break;
        const duration = (v1 ? Number(mdhd.readBigUInt64BE(24)) : mdhd.readUInt32BE(16)) / mdhd.readUInt32BE(v1 ? 20 : 12);
        if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
            && width <= 8192 && height <= 8192 && Number.isFinite(duration) && duration > 0 && duration < 600) {
            return { width, height, duration };
        }
    }
    throw new Error('[TELEGRAM_VIDEO_METADATA_INVALID]');
}

/** Only the configured durable R2 public origin/path may supply the owner-approved MP4. */
export function assertVideo1103Url(raw: string): URL {
    const configured = process.env.R2_PUBLIC_BASE_URL || '';
    if (!URL.canParse(configured) || !URL.canParse(raw)) throw new Error('[TELEGRAM_VIDEO_STORAGE_TARGET_MISMATCH]');
    const base = new URL(configured), url = new URL(raw);
    if (base.protocol !== 'https:' || url.protocol !== 'https:' || url.origin !== base.origin
        || url.username || url.password || url.search || url.hash || isIP(url.hostname)
        || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
        || !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')) {
        throw new Error('[TELEGRAM_VIDEO_STORAGE_TARGET_MISMATCH]');
    }
    return url;
}

/** Bounded, no-redirect R2 read; actual bytes, MP4 signature and SHA must match before dispatch. */
export async function loadVideo1103(raw: string, fetcher: typeof fetch = fetch): Promise<{ file: CustomFile; metadata: Video1103Metadata }> {
    const response = await fetcher(assertVideo1103Url(raw), { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'video/mp4'
        || Number(response.headers.get('content-length') || 0) > TG1103.bytes || !response.body) {
        throw new Error('[TELEGRAM_VIDEO_RESOURCE_INVALID]');
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
        for (;;) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.length;
            if (size > TG1103.bytes) throw new Error('[TELEGRAM_VIDEO_RESOURCE_TOO_LARGE]');
            chunks.push(next.value);
        }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const buffer = Buffer.concat(chunks, size);
    if (size !== TG1103.bytes || buffer.subarray(4, 8).toString('ascii') !== 'ftyp'
        || videoHash(buffer) !== TG1103.assetSha) throw new Error('[TELEGRAM_VIDEO_BYTES_MISMATCH]');
    return { file: new CustomFile('owner-approved-original.mp4', size, '', buffer), metadata: inspectVideo1103Metadata(buffer) };
}
