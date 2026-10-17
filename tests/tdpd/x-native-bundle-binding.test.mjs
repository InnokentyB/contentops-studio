import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildXNativeExtension } from '../../scripts/build_x_native_extension.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function built(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'x-bundle-binding-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const output = path.join(directory, 'package');
    const receipt = await buildXNativeExtension({ output });
    const bytes = new Map(await Promise.all((await readdir(output)).map(async name => [name, await readFile(path.join(output, name))])));
    return { receipt, bytes, read: async name => bytes.get(name) };
}
test('runtime self-measurement equals independent package receipt; modified packaged bytes fail closed', async t => {
    const f = await built(t);
    const { verifyBundle } = await import('../../extensions/x-native/bundle.mjs');
    const measured = await verifyBundle({ read: f.read });
    assert.equal(measured.bundleSha256, f.receipt.bundleSha256);
    assert.match(measured.readerBuildSha256, /^[a-f0-9]{64}$/);
    for (const name of ['manifest.json', 'pilot-native.js', 'store.mjs', 'bundle.mjs', 'README.md']) {
        const original = f.bytes.get(name);
        f.bytes.set(name, Buffer.concat([original, Buffer.from('\nchanged')]));
        await assert.rejects(verifyBundle({ read: f.read }), /LOCAL_BUNDLE_INVALID/);
        f.bytes.set(name, original);
    }
    const original = f.bytes.get('INTEGRITY.json');
    for (const change of [v => v.files.push(v.files[0]), v => v.files.pop(),
        v => { v.files[0].file = '../escape'; }, v => { v.bundleSha256 = 'a'.repeat(64); },
        v => { v.files[0].bytes = '12'; }, v => { v.extra = true; }]) {
        const value = JSON.parse(original); change(value);
        f.bytes.set('INTEGRITY.json', Buffer.from(JSON.stringify(value)));
        await assert.rejects(verifyBundle({ read: f.read }), /LOCAL_BUNDLE_INVALID/);
    }
});
test('reader handshake is bound to built source, not just a stale extension ID', async t => {
    const f = await built(t);
    const { verifyBundle } = await import('../../extensions/x-native/bundle.mjs');
    const measured = await verifyBundle({ read: f.read });
    const source = f.bytes.get('pilot-native.js').toString('utf8');
    const template = source.replace(/const READER_BUILD_SHA256 = '[a-f0-9]{64}';/, "const READER_BUILD_SHA256 = '__X_NATIVE_READER_BUILD__';");
    assert.equal(sha(template), measured.readerBuildSha256);
    assert.notEqual(source, template, 'builder must stamp the reader template identity');
    // Even a recalculated integrity file cannot silently claim a different reader generation.
    f.bytes.set('pilot-native.js', Buffer.from(source.replace(measured.readerBuildSha256, 'b'.repeat(64))));
    const integrity = JSON.parse(f.bytes.get('INTEGRITY.json'));
    const entry = integrity.files.find(value => value.file === 'pilot-native.js');
    entry.sha256 = sha(f.bytes.get('pilot-native.js'));
    integrity.bundleSha256 = sha(JSON.stringify({ schemaVersion: 1, files: integrity.files }));
    f.bytes.set('INTEGRITY.json', Buffer.from(JSON.stringify(integrity)));
    await assert.rejects(verifyBundle({ read: f.read }), /LOCAL_BUNDLE_INVALID/);
});
