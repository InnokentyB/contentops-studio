// Software self-measurement within the reviewed trusted-executor boundary, NOT remote/device attestation.
const FILES = Object.freeze(['README.md', 'bundle.mjs', 'key.mjs', 'manifest.json', 'native-wire.mjs', 'package.mjs',
    'pilot-background.mjs', 'pilot-click.mjs', 'pilot-native.js', 'pilot-ui-controller.mjs', 'pilot-ui.mjs',
    'pilot.css', 'pilot.html', 'store.mjs']);
const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
    byte => byte.toString(16).padStart(2, '0')).join('');
const invalid = () => { throw Error('LOCAL_BUNDLE_INVALID'); };
async function runtimeRead(name) {
    if (name !== 'INTEGRITY.json' && !FILES.includes(name)) invalid();
    const url = new URL(name, chrome.runtime.getURL('pilot.html'));
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) invalid();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 1024 * 1024) invalid();
    return bytes;
}
/** Each authority boundary re-reads packaged bytes; no caller-supplied hash or cached enrollment authority. */
export async function verifyBundle({ read = runtimeRead } = {}) {
    try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const raw = await read('INTEGRITY.json');
        if (!(raw instanceof Uint8Array) || !raw.length || raw.length > 16384) invalid();
        const integrity = JSON.parse(decoder.decode(raw));
        if (!integrity || Object.keys(integrity).sort().join(',') !== 'bundleSha256,files,schemaVersion'
            || integrity.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(integrity.bundleSha256 || '')
            || !Array.isArray(integrity.files) || integrity.files.length !== FILES.length) invalid();
        let reader;
        for (let index = 0; index < FILES.length; index++) {
            const entry = integrity.files[index];
            if (!entry || Object.keys(entry).sort().join(',') !== 'bytes,file,sha256' || entry.file !== FILES[index]
                || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
                || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 1024 * 1024) invalid();
            const bytes = await read(entry.file);
            if (!(bytes instanceof Uint8Array) || bytes.length !== entry.bytes || await sha(bytes) !== entry.sha256) invalid();
            if (entry.file === 'pilot-native.js') reader = decoder.decode(bytes);
        }
        const bundleSha256 = await sha(new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, files: integrity.files })));
        if (bundleSha256 !== integrity.bundleSha256) invalid();
        const markers = [...reader.matchAll(/const READER_BUILD_SHA256 = '([a-f0-9]{64})';/g)];
        if (markers.length !== 1) invalid();
        const readerBuildSha256 = markers[0][1];
        const template = reader.replace(markers[0][0], "const READER_BUILD_SHA256 = '__X_NATIVE_READER_BUILD__';");
        if (await sha(new TextEncoder().encode(template)) !== readerBuildSha256) invalid();
        return { bundleSha256, readerBuildSha256 };
    } catch { invalid(); }
}
