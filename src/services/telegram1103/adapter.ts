import { Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import telegramClientService from '../telegram_client.service';
import { TG1103 } from './contract';
import type { Video1103Metadata } from './media';

export type Video1103Send = { caption: string; target: string; file: CustomFile;
    metadata: Video1103Metadata; idempotencyKey: string };
export type Video1103Receipt = { verified: true; messageId: number; publicUrl: string;
    mimeType: 'video/mp4'; sha256: string };

/** Existing project MTProto session; one native video send, no bot/photo/text fallback or resend. */
export async function sendVideo1103(args: Video1103Send): Promise<Video1103Receipt> {
    if (!await telegramClientService.init(10)) throw new Error('[TELEGRAM_VIDEO_SESSION_UNAVAILABLE]');
    const client = await telegramClientService.getClient(10);
    if (!client) throw new Error('[TELEGRAM_VIDEO_SESSION_UNAVAILABLE]');
    const entity = await client.getEntity(args.target);
    if (!(entity instanceof Api.Channel) || entity.username !== TG1103.username) throw new Error('[TELEGRAM_VIDEO_TARGET_MISMATCH]');
    const sent = await client.sendFile(entity, { file: args.file, caption: args.caption, parseMode: null,
        forceDocument: false, supportsStreaming: true,
        attributes: [new Api.DocumentAttributeVideo({ duration: args.metadata.duration,
            w: args.metadata.width, h: args.metadata.height, supportsStreaming: true })] });
    if (!Number.isSafeInteger(sent.id) || sent.id < 1) throw new Error('[TELEGRAM_VIDEO_PROVIDER_ID_MISSING]');
    const [readback] = await client.getMessages(entity, { ids: [sent.id] });
    const media = readback?.media;
    if (!readback || readback.id !== sent.id || readback.message !== args.caption
        || !(readback.peerId instanceof Api.PeerChannel) || !readback.peerId.channelId.equals(entity.id)
        || !(media instanceof Api.MessageMediaDocument) || !(media.document instanceof Api.Document)
        || media.document.mimeType !== 'video/mp4' || Number(media.document.size) !== TG1103.bytes
        || !media.document.attributes.some(a => a instanceof Api.DocumentAttributeVideo)) {
        throw new Error('[TELEGRAM_VIDEO_READBACK_MISMATCH]');
    }
    return { verified: true, messageId: readback.id, publicUrl: `https://t.me/${entity.username}/${readback.id}`,
        mimeType: 'video/mp4', sha256: TG1103.assetSha };
}
