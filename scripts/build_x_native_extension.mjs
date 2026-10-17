import { lstat, realpath, open, mkdir, mkdtemp, writeFile, rename, rm, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const FILES = Object.freeze(['bundle.mjs', 'key.mjs', 'store.mjs', 'package.mjs', 'native-wire.mjs', 'pilot-click.mjs',
    'pilot-background.mjs', 'pilot-native.js', 'pilot.html', 'pilot-ui.mjs', 'pilot-ui-controller.mjs', 'pilot.css', 'README.md']);
const EXPECTED_MANIFEST = {
    manifest_version: 3, permissions: [],
    host_permissions: ['https://x.com/*', 'https://publishplanner-production.up.railway.app/*'],
    background: { service_worker: 'pilot-background.mjs', type: 'module' }, action: { default_popup: 'pilot.html' },
    options_page: 'pilot.html', content_scripts: [{ matches: ['https://x.com/*'], js: ['pilot-native.js'], run_at: 'document_idle' }],
    content_security_policy: { extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'self' https://publishplanner-production.up.railway.app; base-uri 'none'" }
};
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(`X_NATIVE_PACKAGE_${code}`); };
const within = (root, value) => value === root || value.startsWith(`${root}${path.sep}`);

// Never traverse a source/output ancestor symlink, even if its target is inside the tree.
async function safeDirectory(directory) {
    const absolute = path.resolve(directory), parsed = path.parse(absolute);
    let current = parsed.root;
    for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) fail('DIRECTORY_INVALID');
    }
    if (await realpath(absolute) !== absolute) fail('DIRECTORY_INVALID');
    return absolute;
}

async function readSource(source, name) {
    const filename = path.join(source, name), stat = await lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024) fail('SOURCE_INVALID');
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const current = await handle.stat();
        if (!current.isFile() || current.size > 1024 * 1024) fail('SOURCE_INVALID');
        const content = await handle.readFile();
        if (content.length === 0 || content.length > 1024 * 1024) fail('SOURCE_INVALID');
        return content;
    } finally { await handle.close(); }
}

function validateManifest(content) {
    let manifest;
    try { manifest = JSON.parse(content.toString('utf8')); } catch { fail('MANIFEST_INVALID'); }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('MANIFEST_INVALID');
    const { name, description, version, ...rights } = manifest;
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof description !== 'string'
        || !description.trim() || description.length > 500 || typeof version !== 'string'
        || !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(version)
        || version.split('.').some(part => Number(part) > 65535)
        || !isDeepStrictEqual(rights, EXPECTED_MANIFEST)) fail('MANIFEST_INVALID');
}

function dependency(value, names, kind = 'module') {
    if (typeof value !== 'string' || !value || /[?#\\\s]/.test(value)) fail('DEPENDENCY_INVALID');
    const relative = value.startsWith('./') ? value.slice(2) : value;
    if (relative.includes('/') || !names.has(relative) || (kind === 'module' && !value.startsWith('./')))
        fail('DEPENDENCY_INVALID');
    return relative;
}

function validateJavaScript(name, content, names, ts) {
    const text = content.toString('utf8');
    const tree = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (tree.parseDiagnostics.length) fail('JAVASCRIPT_INVALID');
    function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
            if (!ts.isStringLiteral(node.moduleSpecifier)) fail('DEPENDENCY_INVALID');
            dependency(node.moduleSpecifier.text, names);
        }
        if (ts.isCallExpression(node)) {
            const expression = node.expression;
            const dynamic = expression.kind === ts.SyntaxKind.ImportKeyword
                || (ts.isIdentifier(expression) && ['require', 'importScripts'].includes(expression.text));
            const resource = ts.isPropertyAccessExpression(expression) && expression.name.text === 'getURL'
                && expression.expression.getText(tree) === 'chrome.runtime';
            if (dynamic || resource) {
                if (!node.arguments.length || (resource && node.arguments.length !== 1)) fail('DEPENDENCY_INVALID');
                for (const argument of node.arguments) {
                    if (!ts.isStringLiteral(argument)) fail('DEPENDENCY_INVALID');
                    dependency(argument.text, names, resource ? 'resource' : 'module');
                }
            }
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
            const localUrl = node.expression.text === 'URL' && node.arguments?.[1]?.getText(tree) === 'import.meta.url';
            if (localUrl || ['Worker', 'SharedWorker'].includes(node.expression.text)) {
                const argument = node.arguments?.[0];
                if (!argument || !ts.isStringLiteral(argument)) fail('DEPENDENCY_INVALID');
                dependency(argument.text, names);
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(tree);
    // Parse only: never import or evaluate extension modules, including fixture inputs.
    const checked = spawnSync(process.execPath, ['--check', `--input-type=${name.endsWith('.mjs') ? 'module' : 'commonjs'}`],
        { input: content, timeout: 5000, maxBuffer: 64 * 1024 });
    if (checked.error || checked.status !== 0) fail('JAVASCRIPT_INVALID');
}

function validateHtml(content, names) {
    const text = content.toString('utf8');
    if (!/^<!doctype html>/i.test(text.trim()) || !/<html\b/i.test(text) || !/<\/html\s*>/i.test(text)
        || /\x00|\son\w+\s*=|\b(?:srcset|poster|action|formaction|srcdoc)\s*=|<base\b|<iframe\b|<object\b|<embed\b/i.test(text)) fail('HTML_INVALID');
    const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    if (!scripts.length || (text.match(/<script\b/gi) || []).length !== scripts.length) fail('HTML_INVALID');
    for (const [, attributes, body] of scripts) {
        const source = attributes.match(/\bsrc\s*=\s*(["'])([^"']+)\1/i);
        if (!source || body.trim() || !/\btype\s*=\s*(["'])module\1/i.test(attributes)
            || !dependency(source[2], names, 'resource').endsWith('.mjs')) fail('HTML_INVALID');
    }
    for (const match of text.matchAll(/\b(src|href)\s*=\s*([^\s>]+)/gi)) {
        const quoted = match[2].match(/^(["'])(.+)\1$/);
        if (!quoted) fail('HTML_INVALID');
        dependency(quoted[2], names, 'resource');
    }
}

async function validateSources(source) {
    const buffers = new Map();
    for (const name of [...FILES, 'pilot-manifest.json']) buffers.set(name, await readSource(source, name));
    if ([...buffers.values()].reduce((sum, value) => sum + value.length, 0) > 4 * 1024 * 1024) fail('SOURCE_INVALID');
    validateManifest(buffers.get('pilot-manifest.json'));
    const names = new Set(FILES);
    validateHtml(buffers.get('pilot.html'), names);
    if (/@import\b|url\s*\(/i.test(buffers.get('pilot.css').toString('utf8'))) fail('CSS_DEPENDENCY_INVALID');
    const ts = createRequire(import.meta.url)('typescript');
    for (const [name, content] of buffers) if (/\.(mjs|js)$/.test(name)) validateJavaScript(name, content, names, ts);
    const reader = buffers.get('pilot-native.js').toString('utf8');
    const marker = "const READER_BUILD_SHA256 = '__X_NATIVE_READER_BUILD__';";
    if (reader.split(marker).length !== 2) fail('READER_IDENTITY_INVALID');
    buffers.set('pilot-native.js', Buffer.from(reader.replace(marker, `const READER_BUILD_SHA256 = '${sha(reader)}';`)));
    buffers.set('manifest.json', buffers.get('pilot-manifest.json'));
    buffers.delete('pilot-manifest.json');
    return buffers;
}

async function absent(output) {
    try { await lstat(output); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    fail('OUTPUT_EXISTS');
}

/** Builds data only; it neither installs/enrolls the extension nor authorizes a send. */
export async function buildXNativeExtension(options = {}) {
    let stage, lock, ownsLock = false;
    try {
        const source = await safeDirectory(options.source ?? fileURLToPath(new URL('../extensions/x-native', import.meta.url)));
        const output = path.resolve(options.output ?? 'dist/x-native-extension');
        if (within(source, output)) fail('OUTPUT_INVALID');
        await safeDirectory(path.dirname(output));
        await absent(output);
        const buffers = await validateSources(source);
        const files = [...buffers].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([file, content]) => ({ file, sha256: sha(content), bytes: content.length }));
        const packageData = { schemaVersion: 1, files };
        const integrity = { ...packageData, bundleSha256: sha(JSON.stringify(packageData)) };
        // Exclusive sibling lock serializes cooperating builders. Existing output is never removed.
        lock = `${output}.lock`;
        try { await mkdir(lock, { mode: 0o700 }); ownsLock = true; }
        catch (error) { if (error.code === 'EEXIST') fail('OUTPUT_EXISTS'); throw error; }
        await absent(output);
        stage = await mkdtemp(path.join(path.dirname(output), '.x-native-stage-'));
        for (const [file, content] of buffers) await writeFile(path.join(stage, file), content, { mode: 0o644, flag: 'wx' });
        await writeFile(path.join(stage, 'INTEGRITY.json'), `${JSON.stringify(integrity, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
        await absent(output);
        await rename(stage, output); stage = undefined;
        return { bundleSha256: integrity.bundleSha256, files: files.length };
    } catch (error) {
        if (error instanceof Error && /^X_NATIVE_PACKAGE_[A-Z_]+$/.test(error.message)) throw error;
        fail('BUILD_FAILED');
    } finally {
        if (stage) await rm(stage, { recursive: true, force: true });
        if (ownsLock) await rmdir(lock);
    }
}

async function cli(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        if (!['--source', '--output'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')
            || options[key.slice(2)] !== undefined) fail('ARGUMENT_INVALID');
        options[key.slice(2)] = args[index + 1];
    }
    console.log(JSON.stringify(await buildXNativeExtension(options)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    cli(process.argv.slice(2)).catch(error => {
        console.error(/^X_NATIVE_PACKAGE_[A-Z_]+$/.test(error.message) ? error.message : 'X_NATIVE_PACKAGE_BUILD_FAILED');
        process.exitCode = 1;
    });
}
