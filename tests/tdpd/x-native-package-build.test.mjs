import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/build_x_native_extension.mjs', import.meta.url));
const files = ['key.mjs', 'store.mjs', 'package.mjs', 'native-wire.mjs', 'pilot-click.mjs',
    'pilot-background.mjs', 'pilot-native.js', 'pilot.html', 'pilot-ui.mjs', 'pilot-ui-controller.mjs', 'pilot.css', 'README.md'];
const manifest = {
    manifest_version: 3, name: 'Synthetic X executor', version: '0.2.0', description: 'Synthetic package, never installed.',
    permissions: [], host_permissions: ['https://x.com/*', 'https://publishplanner-production.up.railway.app/*'],
    background: { service_worker: 'pilot-background.mjs', type: 'module' }, action: { default_popup: 'pilot.html' },
    options_page: 'pilot.html', content_scripts: [{ matches: ['https://x.com/*'], js: ['pilot-native.js'], run_at: 'document_idle' }],
    content_security_policy: { extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; connect-src https://publishplanner-production.up.railway.app; base-uri 'none'" }
};
const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
    const root = await mkdtemp(path.join(tmpdir(), 'x-package-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'); await mkdir(source);
    for (const name of files) await writeFile(path.join(source, name), name.endsWith('.mjs') ? 'export const synthetic = true;\n'
        : name.endsWith('.js') ? '(() => {})();\n' : name.endsWith('.css') ? 'body { color: black; }\n' : 'Synthetic instructions.\n');
    await writeFile(path.join(source, 'pilot.html'), '<!doctype html><html><head><link rel="stylesheet" href="pilot.css"></head><body><script type="module" src="pilot-ui.mjs"></script></body></html>');
    await writeFile(path.join(source, 'pilot-ui.mjs'), "import './pilot-ui-controller.mjs';\n");
    await writeFile(path.join(source, 'pilot-manifest.json'), JSON.stringify(manifest));
    // Old key-only prerequisite and unrelated files must never enter the package.
    await writeFile(path.join(source, 'manifest.json'), '{"name":"OLD KEY ONLY"}');
    await writeFile(path.join(source, 'unrelated-secret.txt'), 'synthetic-not-for-package');
    return { root, source, output: path.join(root, 'bundle') };
}
async function build(options) {
    const module = await import(script);
    assert.equal(typeof module.buildXNativeExtension, 'function', 'installable package builder export is required');
    return module.buildXNativeExtension(options);
}
async function pristine(f) {
    await assert.rejects(readFile(path.join(f.output, 'manifest.json')), { code: 'ENOENT' });
    assert.deepEqual((await readdir(f.root)).sort(), ['source']);
}
test('package builder is import-safe and exports the explicit build operation', async () => {
    assert.equal(typeof (await import(script)).buildXNativeExtension, 'function');
});
test('complete package is allowlisted, deterministic and independently hash-verifiable', async t => {
    const f = await fixture(t), first = await build(f);
    assert.deepEqual((await readdir(f.output)).sort(), [...files, 'manifest.json', 'INTEGRITY.json'].sort());
    assert.deepEqual(JSON.parse(await readFile(path.join(f.output, 'manifest.json'))), manifest);
    const bytes = await readFile(path.join(f.output, 'INTEGRITY.json')), integrity = JSON.parse(bytes);
    assert.equal(integrity.schemaVersion, 1);
    assert.deepEqual(integrity.files.map(entry => entry.file), [...files, 'manifest.json'].sort());
    for (const entry of integrity.files) {
        const content = await readFile(path.join(f.output, entry.file));
        assert.equal(entry.bytes, content.length); assert.equal(entry.sha256, sha(content));
    }
    assert.equal(integrity.bundleSha256, sha(JSON.stringify({ schemaVersion: 1, files: integrity.files })));
    assert.equal(first.bundleSha256, integrity.bundleSha256);
    await build({ source: f.source, output: path.join(f.root, 'second') });
    assert.deepEqual(await readFile(path.join(f.root, 'second/INTEGRITY.json')), bytes);
    assert.equal(bytes.includes(Buffer.from(f.root)), false);
    await writeFile(path.join(f.source, 'README.md'), 'Changed synthetic instructions.\n');
    const changed = await build({ source: f.source, output: path.join(f.root, 'third') });
    assert.notEqual(changed.bundleSha256, first.bundleSha256);
});
test('missing mandatory sources never expose a partial output or staging directory', async t => {
    for (const name of ['pilot.html', 'pilot-ui.mjs', 'pilot-ui-controller.mjs', 'README.md', 'pilot-manifest.json']) {
        const f = await fixture(t); await unlink(path.join(f.source, name));
        await assert.rejects(build(f), /X_NATIVE_PACKAGE_/); await pristine(f);
    }
});
test('file and source ancestor symlinks reject before output', async t => {
    const f = await fixture(t);
    await unlink(path.join(f.source, 'README.md')); await symlink(path.join(f.source, 'pilot.css'), path.join(f.source, 'README.md'));
    await assert.rejects(build(f), /X_NATIVE_PACKAGE_/); await pristine(f);
    const other = await fixture(t); await symlink(other.source, path.join(other.root, 'alias'));
    await assert.rejects(build({ source: path.join(other.root, 'alias'), output: other.output }), /X_NATIVE_PACKAGE_/);
    await assert.rejects(readFile(path.join(other.output, 'manifest.json')), { code: 'ENOENT' });
});
test('manifest widening, old prerequisite manifest and malformed JSON fail closed', async t => {
    const variants = [m => m.permissions.push('cookies'), m => m.host_permissions.push('<all_urls>'),
        m => m.externally_connectable = { matches: ['https://x.com/*'] },
        m => m.background.service_worker = 'missing.mjs', m => m.content_scripts[0].matches.push('https://evil.invalid/*'),
        m => m.content_security_policy.extension_pages += "; script-src 'unsafe-eval'", m => delete m.action];
    for (const change of variants) {
        const f = await fixture(t), value = structuredClone(manifest); change(value);
        await writeFile(path.join(f.source, 'pilot-manifest.json'), JSON.stringify(value));
        await assert.rejects(build(f), /X_NATIVE_PACKAGE_/); await pristine(f);
    }
    for (const value of ['{"broken":', '{"manifest_version":3,"name":"key prerequisite"}']) {
        const f = await fixture(t); await writeFile(path.join(f.source, 'pilot-manifest.json'), value);
        await assert.rejects(build(f), /X_NATIVE_PACKAGE_/); await pristine(f);
    }
});
test('invalid syntax and missing, external, computed or escaping dependencies reject without execution', async t => {
    for (const value of ["import './missing.mjs';", "import 'node:fs';", "import '../escape.mjs';", "import('https://evil.invalid/a.mjs');",
        "import(variable);", "new URL('./missing.mjs', import.meta.url);", "new Worker('./missing.mjs');", 'export const broken = ;']) {
        const f = await fixture(t); await writeFile(path.join(f.source, 'pilot-ui.mjs'), value);
        await assert.rejects(build(f), /X_NATIVE_PACKAGE_/); await pristine(f);
    }
    for (const value of ['<html><script src="missing.mjs"></script></html>',
        '<html><script src="https://evil.invalid/a.mjs"></script></html>', '<html><script>throw Error("must not execute");</script></html>',
        '<!doctype html><html><script type="module" src="pilot-ui.mjs"></script><img srcset="https://evil.invalid/a.png 1x"></html>']) {
        const f = await fixture(t); await writeFile(path.join(f.source, 'pilot.html'), value);
        await assert.rejects(build(f), /X_NATIVE_PACKAGE_/); await pristine(f);
    }
});
test('output ancestor symlinks and pre-existing lock are preserved without writes', async t => {
    const f = await fixture(t); await symlink(f.source, path.join(f.root, 'alias'));
    await assert.rejects(build({ source: f.source, output: path.join(f.root, 'alias', 'bundle') }), /X_NATIVE_PACKAGE_/);
    assert.equal((await readdir(f.source)).includes('bundle'), false);
    const locked = await fixture(t); await mkdir(`${locked.output}.lock`);
    await writeFile(path.join(`${locked.output}.lock`, 'preserved'), 'another builder');
    await assert.rejects(build(locked), /X_NATIVE_PACKAGE_OUTPUT_EXISTS/);
    assert.equal(await readFile(path.join(`${locked.output}.lock`, 'preserved'), 'utf8'), 'another builder');
    assert.deepEqual((await readdir(locked.root)).sort(), ['bundle.lock', 'source']);
});
test('existing output is preserved and concurrent builds publish exactly once', async t => {
    const f = await fixture(t); await mkdir(f.output); await writeFile(path.join(f.output, 'preserved.txt'), 'original');
    await assert.rejects(build(f), /X_NATIVE_PACKAGE_OUTPUT_EXISTS/);
    assert.equal(await readFile(path.join(f.output, 'preserved.txt'), 'utf8'), 'original');
    assert.deepEqual((await readdir(f.root)).sort(), ['bundle', 'source']);
    const concurrent = await fixture(t), results = await Promise.allSettled([build(concurrent), build(concurrent)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.deepEqual((await readdir(concurrent.root)).sort(), ['bundle', 'source']);
    assert.ok(JSON.parse(await readFile(path.join(concurrent.output, 'INTEGRITY.json'))).bundleSha256);
});
test('CLI supports explicit source/output without evaluating extension source', async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.source, 'key.mjs'), 'throw Error("MUST_NOT_EXECUTE_EXTENSION");\n');
    const result = spawnSync(process.execPath, [script, '--source', f.source, '--output', f.output], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr); assert.ok(JSON.parse(result.stdout).bundleSha256);
    assert.equal(JSON.parse(await readFile(path.join(f.output, 'manifest.json'))).version, manifest.version);
});
