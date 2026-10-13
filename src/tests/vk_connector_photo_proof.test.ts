import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyVkConnectorOriginalPhoto } from '../services/vk_connector_photo_proof';
const bytes = Buffer.from('original provider fixture bytes');
const digest = createHash('sha256').update(bytes).digest('hex');
const source = { originalUrl: 'https://sun9-1.userapi.com/fixture-original.png', capturedAt: '2026-10-13T12:00:00Z',
    postObjectId: '-240051152_61', providerMediaId: 'photo-240051152_55' };
test('VK017 server verifies pinned original photo bytes without cookies or redirects', async () => {
    const result = await verifyVkConnectorOriginalPhoto(source, digest, async (_url, options) => {
        assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
        return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
    });
    assert.equal(result.verified, true);
});
test('VK017 photo proof rejects unpinned URLs, mismatched bytes and oversized/nonimage downloads', async () => {
    let calls = 0;
    const fetchImage = async () => { calls++; return new Response(bytes, { headers: { 'Content-Type': 'image/png' } }); };
    for (const originalUrl of ['https://127.0.0.1/x', 'https://userapi.com.evil.test/x', 'http://sun9.userapi.com/x', 'https://x:user@sun9.userapi.com/x']) {
        assert.equal((await verifyVkConnectorOriginalPhoto({ ...source, originalUrl }, digest, fetchImage)).verified, false);
    }
    assert.equal(calls, 0);
    assert.equal((await verifyVkConnectorOriginalPhoto(source, '0'.repeat(64), fetchImage)).verified, false);
    assert.equal((await verifyVkConnectorOriginalPhoto(source, digest, async () => new Response(bytes))).verified, false);
    assert.equal((await verifyVkConnectorOriginalPhoto(source, digest, async () => new Response(bytes,
        { headers: { 'Content-Type': 'image/png', 'Content-Length': '20000001' } }))).verified, false);
});
