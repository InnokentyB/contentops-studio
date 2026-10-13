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

test('MTProto personal Story binds a native URL media area to the approved pixel rectangle', async (t) => {
    const requests: any[] = [];
    const fakeClient = { uploadFile: async () => new Api.InputFile({ id: bigInt(2), parts: 1, name: 'story.jpg', md5Checksum: '' }),
        invoke: async (request: any) => {
            requests.push(request);
            if (request instanceof Api.stories.CanSendStory) return true;
            if (request instanceof Api.stories.SendStory) return { updates: [new Api.UpdateStoryID({ id: 56, randomId: request.randomId })] };
            if (request instanceof Api.stories.GetStoriesByID) return { stories: [{ id: 56 }] };
            if (request instanceof Api.stories.ExportStoryLink) return { link: 'https://t.me/InnokentyB/s/56' };
            throw new Error('Unexpected request');
        } };
    const service = new TelegramClientService();
    service.getClient = async () => fakeClient as never;
    t.mock.method(globalThis, 'fetch', async () => new Response(Uint8Array.from([255, 216, 255]), { status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '3' } }));
    await service.publishPersonalStory({ projectId: 10, caption: '', imageUrl: 'https://assets.example/story.jpg',
        idempotencyKey: 'story1100-frame3', nativeLink: { url: 'https://t.me/spherical_analyst/1279',
            label: 'Читать разбор', canvasWidth: 1080, canvasHeight: 1920,
            centerX: 540, centerY: 1495, width: 480, height: 110 } });
    const sent = requests.find(request => request instanceof Api.stories.SendStory) as any;
    assert.equal(sent.mediaAreas.length, 1);
    assert.ok(sent.mediaAreas[0] instanceof Api.MediaAreaUrl);
    assert.equal(sent.mediaAreas[0].url, 'https://t.me/spherical_analyst/1279');
    assert.equal(sent.mediaAreas[0].coordinates.x, 50);
    assert.equal(sent.mediaAreas[0].coordinates.y, 1495 / 1920 * 100);
    assert.equal(sent.mediaAreas[0].coordinates.w, 480 / 1080 * 100);
    assert.equal(sent.mediaAreas[0].coordinates.h, 110 / 1920 * 100);
});
