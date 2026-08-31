import assert from 'node:assert/strict';
import test from 'node:test';
import {
    decodeVisualBase64,
    inspectVisualBinary,
    isServerResolvableVisualUrl
} from '../services/visual_asset_binding.service';

function png(width: number, height: number, colorType = 2) {
    const value = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value, 0);
    value.writeUInt32BE(13, 8);
    value.write('IHDR', 12, 'ascii');
    value.writeUInt32BE(width, 16);
    value.writeUInt32BE(height, 20);
    value[24] = 8;
    value[25] = colorType;
    return value;
}

test('managed visual metadata is derived from the binary rather than caller claims', () => {
    const source = png(800, 600);
    const metadata = inspectVisualBinary(source, 'image/png');
    assert.equal(metadata.mime_type, 'image/png');
    assert.equal(metadata.width, 800);
    assert.equal(metadata.height, 600);
    assert.equal(metadata.color_mode, 'RGB');
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
});

test('visual base64 and durable URL validation reject unsafe inputs', () => {
    assert.deepEqual(decodeVisualBase64(Buffer.from('image').toString('base64')), Buffer.from('image'));
    assert.throws(() => decodeVisualBase64('not base64!?'), /BASE64_INVALID/);
    assert.equal(isServerResolvableVisualUrl('file:///tmp/source.png'), false);
    assert.equal(isServerResolvableVisualUrl('https://localhost/source.png'), false);
    assert.equal(isServerResolvableVisualUrl('https://cdn.example/source.png'), true);
});
