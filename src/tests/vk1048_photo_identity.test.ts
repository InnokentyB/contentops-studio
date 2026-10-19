import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createVkConnectorPhotoDigestVerifier } from '../services/vk_connector_photo_identity';
test('MEDIA-001 acknowledgement requires exact directly bound provider-photo bytes', async () => {
    const bytes = Buffer.from('approved image'); const digest = createHash('sha256').update(bytes).digest('hex');
    const card = { objectId: '-240051152_7', publicUrl: 'https://vk.com/wall-240051152_7', text: 'text',
        dates: ['2026-10-13T08:00:00Z'], photoIds: ['photo-240051152_8'], expanded: true };
    const trusted = createVkConnectorPhotoDigestVerifier(digest, { loadOriginal: async () => ({ providerMediaId: card.photoIds[0], bytes }) });
    assert.equal((await trusted.verify(card))?.assetSha256, digest);
    const mismatch = createVkConnectorPhotoDigestVerifier(digest, { loadOriginal: async () => ({ providerMediaId: 'photo-240051152_9', bytes }) });
    assert.equal(await mismatch.verify(card), null);
    const wrongBytes = createVkConnectorPhotoDigestVerifier(digest, { loadOriginal: async () => ({ providerMediaId: card.photoIds[0], bytes: Buffer.from('other image') }) });
    assert.equal(await wrongBytes.verify(card), null);
});

test('MEDIA-002 original-photo stream stops before accumulating over 20MB without a Content-Length', async () => {
    const { readVkConnectorBoundedImage } = await import('../services/vk_connector_bounded_image');
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new Uint8Array(10_000_001)); controller.enqueue(new Uint8Array(10_000_000));
    }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } });
    assert.equal(await readVkConnectorBoundedImage(response), null); assert.equal(cancelled, true);
});
