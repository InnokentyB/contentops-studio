import test from 'node:test';
import assert from 'node:assert/strict';
import { Api } from 'telegram/tl';
import bigInt from 'big-integer';
import { TelegramClientService } from '../services/telegram_client.service';

test('MTProto personal Story uploads an approved MP4 as a streaming document', async (t) => {
    const requests: any[] = [];
    const fakeClient = { uploadFile: async () => new Api.InputFile({ id: bigInt(1), parts: 1, name: 'story.mp4', md5Checksum: '' }),
        invoke: async (request: any) => {
            requests.push(request);
            if (request instanceof Api.stories.CanSendStory) return true;
            if (request instanceof Api.stories.SendStory) return { updates: [new Api.UpdateStoryID({ id: 55, randomId: request.randomId })] };
            if (request instanceof Api.stories.GetStoriesByID) return { stories: [{ id: 55 }] };
            if (request instanceof Api.stories.ExportStoryLink) return { link: 'https://t.me/InnokentyB/s/55' };
            throw new Error('Unexpected request');
        } };
    const service = new TelegramClientService();
    service.getClient = async () => fakeClient as never;
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
    t.mock.method(globalThis, 'fetch', async () => new Response(mp4, { status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(mp4.length) } }));
    const result = await service.publishPersonalStory({ projectId: 10, caption: 'caption',
        imageUrl: 'https://assets.example/story.mp4', idempotencyKey: 'story1099',
        mediaMetadata: { mimeType: 'video/mp4', width: 1080, height: 1920, durationSeconds: 42.033008 } });
    const sent = requests.find(request => request instanceof Api.stories.SendStory) as any;
    assert.ok(sent.media instanceof Api.InputMediaUploadedDocument);
    assert.equal(sent.media.mimeType, 'video/mp4');
    const video = sent.media.attributes.find((attribute: any) => attribute instanceof Api.DocumentAttributeVideo);
    assert.equal(video.w, 1080);
    assert.equal(video.h, 1920);
    assert.equal(video.duration, 42.033008);
    assert.deepEqual(result, { storyId: 55, publicLink: 'https://t.me/InnokentyB/s/55' });
});
