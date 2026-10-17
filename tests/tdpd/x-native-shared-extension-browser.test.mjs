import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createHash, createPublicKey, verify } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.X_BROWSER_PLAYWRIGHT_MODULE || 'playwright');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
        : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const text = 'Synthetic accepted publication. No live provider access.';
const fixture = id => ({ projectId: id, taskId: id + 100, channelId: id + 200, revision: 2,
    bodySha256: sha(text), account: `@fixture_${id}`, profileUrl: `https://x.com/fixture_${id}`,
    scheduleAt: '2026-10-17T10:00:00.000Z' });

// Test-derived loopback packages are genuinely different bundles. Never reuse the distributable's digest.
async function refreshFixtureIntegrity(directory) {
    const inventory = ['README.md', 'bundle.mjs', 'key.mjs', 'manifest.json', 'native-wire.mjs', 'package.mjs',
        'pilot-background.mjs', 'pilot-click.mjs', 'pilot-native.js', 'pilot-ui-controller.mjs', 'pilot-ui.mjs',
        'pilot.css', 'pilot.html', 'store.mjs'];
    const files = [];
    for (const file of inventory) {
        const content = await readFile(path.join(directory, file));
        files.push({ file, sha256: sha(content), bytes: content.length });
    }
    const measured = { schemaVersion: 1, files };
    const integrity = { ...measured, bundleSha256: sha(JSON.stringify(measured)) };
    await writeFile(path.join(directory, 'INTEGRITY.json'), `${JSON.stringify(integrity, null, 2)}\n`);
    return integrity;
}

test('shared installable extension: two accounts/packages no-send, signed pairing, expiry and persistent one-click fence', async () => {
    const sourceExtension = path.resolve(process.env.X_BROWSER_EXTENSION_DIR || 'dist/x-native-extension');
    const temporary = await mkdtemp(path.join(tmpdir(), 'contentops-x-shared-fixture-'));
    const extension = path.join(temporary, 'fixture-extension');
    const profile = path.join(temporary, 'profile');
    let context; let active = fixture(301); let wrongAccount = false; let historyWrongAccount = false;
    let composerLoads = 0;
    let planner = null; let prohibitedRequests = 0; let expectedOrigin = null; let plannerError = null;
    const observedOrigins = [];
    const server = http.createServer(async (request, response) => {
        try {
            assert.equal(request.headers.origin, expectedOrigin, 'the actual extension worker must supply its enrolled Origin');
            observedOrigins.push(request.headers.origin);
            response.setHeader('Access-Control-Allow-Origin', expectedOrigin);
            response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
            assert.equal(request.method, 'POST');
            assert.equal(typeof planner, 'function', 'unconfigured Planner transport must fail closed');
            let body = '';
            for await (const chunk of request) { body += chunk; assert.ok(body.length < 16384); }
            const result = await planner(new URL(request.url, 'http://fixture.invalid').pathname, JSON.parse(body));
            response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
        } catch (error) {
            plannerError = error;
            response.writeHead(500, { 'Content-Type': 'application/json' }); response.end('{"code":"SYNTHETIC_PLANNER_REJECTED"}');
        }
    });
    try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const mockOrigin = `http://127.0.0.1:${address.port}`;
    // Derive a temporary fixture package, never edit the distributable: no production transport is reachable.
    await cp(sourceExtension, extension, { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions = ['https://x.com/*', `${mockOrigin}/*`];
    manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages
        .replace('https://publishplanner-production.up.railway.app', mockOrigin);
    await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
    const background = await readFile(path.join(extension, 'pilot-background.mjs'), 'utf8');
    assert.equal(background.split('https://publishplanner-production.up.railway.app').length, 2);
    await writeFile(path.join(extension, 'pilot-background.mjs'), background.replace('https://publishplanner-production.up.railway.app', mockOrigin));
    const fixtureIntegrity = await refreshFixtureIntegrity(extension);
    const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
        chromiumSandbox: true,
        ...(process.env.X_BROWSER_EXECUTABLE ? { executablePath: process.env.X_BROWSER_EXECUTABLE } : {}),
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
        context = await launch();
        const sandbox = await context.newPage(); await sandbox.goto('chrome://sandbox');
        const diagnostics = (await sandbox.locator('body').innerText()).replace(/\s+/g, ' ');
        const sandboxEvidence = { namespace: /(Namespace sandbox|PID namespaces)\s+Yes/i.test(diagnostics),
            seccomp: /Seccomp-BPF sandbox\s+Yes/i.test(diagnostics), version: context.browser().version() };
        assert.equal(sandboxEvidence.namespace, true, 'actual Chromium namespace sandbox must be enabled');
        assert.equal(sandboxEvidence.seccomp, true, 'actual Chromium seccomp sandbox must be enabled');
        console.log(JSON.stringify({ sandbox: sandboxEvidence }));
        await sandbox.close();
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.protocol === 'chrome-extension:') return route.continue();
            if (url.origin === mockOrigin) return route.continue();
            if (url.origin !== 'https://x.com' || route.request().method() !== 'GET') {
                prohibitedRequests++; return route.abort('blockedbyclient');
            }
            const handle = active.account.slice(1);
            if (url.pathname.startsWith('/compose/')) composerLoads++;
            const body = url.pathname.startsWith('/compose/')
                ? `<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true">${composerLoads === 1 ? text : 'Unapproved new composer after navigation'}</div><button data-testid="tweetButton">Post</button></div>`
                : `<article data-testid="tweet"><div data-testid="User-Name"><a href="/${handle}">${handle}</a></div><a href="/${handle}/status/100"><time datetime="2026-10-17T09:00:00Z">old</time></a><div data-testid="tweetText">Synthetic historical fixture.</div></article>`;
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><button data-testid="SideNav_AccountSwitcher_Button">${wrongAccount || historyWrongAccount ? '@foreign' : active.account}</button>${body}</body></html>` });
        });
        const native = await context.newPage(); await native.goto('https://x.com/compose/post');
        await native.evaluate(() => { document.body.dataset.editorSentinel = 'original-operator-document'; });
        let originalNavigations = 0;
        native.on('framenavigated', frame => { if (frame === native.mainFrame()) originalNavigations++; });
        const checkOriginalEditor = async expectedText => {
            assert.equal(native.url(), 'https://x.com/compose/post');
            assert.equal(originalNavigations, 0, 'inspection must never navigate the original editor');
            assert.equal(await native.getAttribute('body', 'data-editor-sentinel'), 'original-operator-document');
            assert.equal(await native.locator('[contenteditable]').innerText(), expectedText);
            assert.equal(context.pages().filter(candidate => candidate.url().startsWith('https://x.com/')).length, 1,
                'all controlled profile tabs must be closed');
        };
        const setOperatorDraft = async (account, draft) => native.evaluate(({ account, draft }) => {
            document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]').textContent = account;
            document.querySelector('[contenteditable]').textContent = draft;
        }, { account, draft });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const extensionUrl = new URL(worker.url());
        assert.equal(extensionUrl.protocol, 'chrome-extension:');
        assert.match(extensionUrl.hostname, /^[a-p]{32}$/);
        // Node's WHATWG URL treats extension origins as opaque and reports "null".
        const base = `chrome-extension://${extensionUrl.hostname}`;
        expectedOrigin = base;
        const page = await context.newPage(); await page.goto(`${base}/pilot.html`);
        assert.equal(await page.locator('#run').isDisabled(), true);
        if (process.env.X_BROWSER_EVIDENCE_DIR && process.env.X_BROWSER_CAPTURE_SCREENSHOTS !== '0') {
            assert.ok(path.isAbsolute(process.env.X_BROWSER_EVIDENCE_DIR));
            await mkdir(process.env.X_BROWSER_EVIDENCE_DIR, { recursive: true });
            await page.locator('#package').fill(JSON.stringify(active, null, 2));
            for (const [name, width] of [['desktop', 720], ['mobile', 360]]) {
                await page.setViewportSize({ width, height: 960 });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
                    `popup must not overflow at ${width}px`);
                await page.screenshot({ path: path.join(process.env.X_BROWSER_EVIDENCE_DIR, `${name}.png`), fullPage: true });
            }
        }
        const identity = await page.evaluate(() => chrome.runtime.sendMessage({ operation: 'identity' }));
        assert.equal(identity.bundleSha256, fixtureIntegrity.bundleSha256, JSON.stringify(identity));
        assert.equal(identity.publicKey.d, undefined);
        for (const id of [301, 302]) {
            active = fixture(id);
            await setOperatorDraft(active.account, text);
            const result = await page.evaluate(({ packageData, text }) => chrome.runtime.sendMessage({ operation: 'uat', packageData, text }), { packageData: active, text });
            assert.equal(result.no_send, true, JSON.stringify(result));
            assert.equal(result.account, active.account); assert.equal(result.body_sha256, sha(text));
            assert.equal(result.publication_authorized, false); assert.equal(result.history_complete, true);
            assert.equal(await page.locator('#run').isDisabled(), true);
            await checkOriginalEditor(text);
        }
        wrongAccount = true;
        await setOperatorDraft('@foreign', text);
        const denied = await page.evaluate(({ packageData, text }) => chrome.runtime.sendMessage({ operation: 'uat', packageData, text }), { packageData: active, text });
        assert.equal(denied.code, 'NATIVE_ACCOUNT_MISMATCH'); wrongAccount = false;
        await checkOriginalEditor(text);
        await setOperatorDraft(active.account, 'Unknown existing draft');
        const draft = await page.evaluate(({ packageData, text }) => chrome.runtime.sendMessage({ operation: 'uat', packageData, text }), { packageData: active, text });
        assert.equal(draft.code, 'NATIVE_EDITOR_TEXT_MISMATCH');
        await checkOriginalEditor('Unknown existing draft');
        await setOperatorDraft(active.account, text);
        historyWrongAccount = true;
        const failedHistory = await page.evaluate(({ packageData, text }) => chrome.runtime.sendMessage({ operation: 'uat', packageData, text }), { packageData: active, text });
        assert.equal(failedHistory.code, 'NATIVE_ACCOUNT_MISMATCH');
        historyWrongAccount = false;
        await checkOriginalEditor(text);
        for (const id of [301, 302]) {
        active = fixture(id);
        await setOperatorDraft(active.account, text);
        const pairChallenge = { ...active, version: 1, purpose: 'pair', extensionId: new URL(base).hostname,
            installationId: identity.installationId, bundleSha256: identity.bundleSha256, actorId: 'user:fixture', nonce: 'd'.repeat(64),
            manifest: `sha256:${'e'.repeat(64)}`, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString() };
        let paired = false;
        planner = async (url, value) => {
            const { signature, ...payload } = value;
            const purpose = url.endsWith('/pair-read') ? 'read-challenge' : 'pairing';
            assert.equal(verify('sha256', Buffer.from(`ContentOps:X-native:${purpose}:v1\n${canonical(payload)}`),
                { key: createPublicKey({ key: identity.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
            if (purpose === 'read-challenge') {
                assert.equal(value.bundleSha256, identity.bundleSha256);
                assert.equal(value.projectId, active.projectId); assert.equal(value.channelId, active.channelId);
                return { challenge: pairChallenge, accepted_text: text };
            }
            assert.equal(value.challenge.bundleSha256, identity.bundleSha256);
            assert.equal(value.account, active.account); paired = true;
            return { mode: 'pairing_verified', publication_authorized: false };
        };
        const pairResult = await page.evaluate(({ packageData, nonce }) => chrome.runtime.sendMessage({ operation: 'uat', packageData, nonce }), { packageData: active, nonce: pairChallenge.nonce });
        assert.equal(plannerError, null);
        assert.equal(pairResult.pairing_verified, true, JSON.stringify(pairResult)); assert.equal(paired, true);
        await checkOriginalEditor(text);
        }
        assert.ok(observedOrigins.length >= 2);
        assert.ok(observedOrigins.every(origin => origin === base));
        await checkOriginalEditor(text);
        const lifecycle = phase => ({ ...active, version: 1, purpose: 'publication', phase,
            workItemId: 701, attemptId: phase === 'start' ? null : 901, actorId: 'user:fixture',
            installationId: identity.installationId, bundleSha256: identity.bundleSha256, nonce: 'a'.repeat(64), manifest: `sha256:${'e'.repeat(64)}`,
            leaseSha256: 'b'.repeat(64), releaseKeySha256: 'a'.repeat(64), sendKeySha256: 'c'.repeat(64),
            issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString() });
        const receiptPhases = [];
        planner = async (url, value) => {
            const operation = url.split('/').at(-1);
            const proof = operation === 'receipt' ? value.receipt : value;
            const { signature, ...payload } = proof;
            const purpose = operation === 'receipt' ? 'receipt' : 'read-challenge';
            assert.equal(operation === 'receipt' ? proof.challenge.bundleSha256 : proof.bundleSha256, identity.bundleSha256);
            assert.equal(verify('sha256', Buffer.from(`ContentOps:X-native:${purpose}:v1\n${canonical(payload)}`),
                { key: createPublicKey({ key: identity.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
            if (operation === 'read') return { challenge: lifecycle('start'), accepted_text: text };
            if (operation === 'receipt') { receiptPhases.push(value.receipt.challenge.phase); return { mode: 'attempt_started' }; }
            assert.equal(operation, 'advance');
            // Simulate an operator edit after history and start receipt, before the final native editor check.
            await setOperatorDraft(active.account, 'Operator changed draft after history');
            return { challenge: lifecycle('permit'), accepted_text: text };
        };
        const changedBeforePermit = await page.evaluate(({ packageData, nonce }) => chrome.runtime.sendMessage({
            operation: 'run', packageData, nonce }), { packageData: active, nonce: 'a'.repeat(64) });
        assert.equal(plannerError, null);
        assert.equal(changedBeforePermit.code, 'NATIVE_EDITOR_TEXT_MISMATCH');
        assert.deepEqual(receiptPhases, ['start'], 'no submission permit receipt follows a changed original editor');
        await checkOriginalEditor('Operator changed draft after history');
        await setOperatorDraft(active.account, text);
        await native.evaluate(() => document.querySelector('[data-testid="tweetButton"]').onclick = () => {
            document.body.dataset.clicks = String(Number(document.body.dataset.clicks || 0) + 1);
        });
        const expired = await page.evaluate(async ({ packageData, text }) => {
            const { readerBuildSha256 } = await (await import('./bundle.mjs')).verifyBundle();
            const [tab] = await chrome.tabs.query({ url: 'https://x.com/*' });
            return chrome.tabs.sendMessage(tab.id, { operation: 'click', packageData, text, readerBuildSha256,
                permit: { attemptId: 900, expiresAt: new Date(Date.now() - 1).toISOString() } });
        }, { packageData: active, text });
        assert.equal(expired.code, 'NATIVE_PERMIT_EXPIRED');
        const overlong = await page.evaluate(async ({ packageData, text }) => {
            const { readerBuildSha256 } = await (await import('./bundle.mjs')).verifyBundle();
            const [tab] = await chrome.tabs.query({ url: 'https://x.com/*' });
            return chrome.tabs.sendMessage(tab.id, { operation: 'click', packageData, text, readerBuildSha256,
                permit: { attemptId: 901, expiresAt: new Date(Date.now() + 60000).toISOString() } });
        }, { packageData: active, text });
        assert.equal(overlong.code, 'NATIVE_PERMIT_EXPIRED', 'the native permit cannot exceed 15 seconds');
        assert.equal(await native.evaluate(() => document.body.dataset.clicks || '0'), '0');
        const clicks = await page.evaluate(async packageData => {
            const { nativeClickOnce } = await import('./pilot-click.mjs'); let invokes = 0;
            const permit = { ...packageData, releaseKeySha256: 'f'.repeat(64), submissionPermitted: true,
                attemptId: 900, serverAttemptId: 900, nonce: 'c'.repeat(64), expiresAt: new Date(Date.now() + 10000).toISOString() };
            const invoke = () => { invokes++; throw Error('SYNTHETIC_LOST_RESPONSE'); };
            await Promise.allSettled([nativeClickOnce(permit, invoke), nativeClickOnce(permit, invoke)]);
            return invokes;
        }, active);
        assert.equal(clicks, 1); assert.equal(prohibitedRequests, 0);
        await context.close(); context = await launch();
        const reopened = await context.newPage(); await reopened.goto(`${base}/pilot.html`);
        const persisted = await reopened.evaluate(() => chrome.runtime.sendMessage({ operation: 'identity' }));
        assert.equal(persisted.installationId, identity.installationId);
        assert.equal(persisted.bundleSha256, identity.bundleSha256);
        const replay = await reopened.evaluate(async packageData => {
            const { nativeClickOnce } = await import('./pilot-click.mjs'); let invokes = 0; let code = null;
            try {
                await nativeClickOnce({ ...packageData, releaseKeySha256: 'f'.repeat(64), submissionPermitted: true,
                    attemptId: 900, serverAttemptId: 900, nonce: 'c'.repeat(64), expiresAt: new Date(Date.now() + 10000).toISOString() }, () => { invokes++; });
            } catch (error) { code = error.message; }
            return { invokes, code };
        }, active);
        assert.equal(replay.invokes, 0, 'restart never clears a possibly clicked attempt');
        assert.match(replay.code, /^LOCAL_JOURNAL_(CONFLICT|ABORTED)$/);
        const originalReadme = await readFile(path.join(extension, 'README.md'));
        const originalIntegrity = await readFile(path.join(extension, 'INTEGRITY.json'));
        const networkBeforeMutation = observedOrigins.length;
        await writeFile(path.join(extension, 'README.md'), Buffer.concat([originalReadme, Buffer.from('\nSynthetic reviewed next-build fixture.\n')]));
        const invalid = await reopened.evaluate(({ packageData }) => chrome.runtime.sendMessage({
            operation: 'readiness', packageData, nonce: 'a'.repeat(64) }), { packageData: active });
        assert.equal(invalid.code, 'LOCAL_BUNDLE_INVALID', 'mutated bytes with old integrity fail before signing or network');
        assert.equal(observedOrigins.length, networkBeforeMutation);
        const changedIntegrity = await refreshFixtureIntegrity(extension);
        assert.notEqual(changedIntegrity.bundleSha256, identity.bundleSha256);
        await context.close(); context = await launch();
        const rotated = await context.newPage(); await rotated.goto(`${base}/pilot.html`);
        const rotatedIdentity = await rotated.evaluate(() => chrome.runtime.sendMessage({ operation: 'identity' }));
        assert.equal(rotatedIdentity.extensionId, identity.extensionId, 'same path and manifest retain extension identity');
        assert.equal(rotatedIdentity.bundleSha256, changedIntegrity.bundleSha256);
        assert.notEqual(rotatedIdentity.installationId, identity.installationId, 'a new measured bundle gets its own key');
        const rotationProof = await rotated.evaluate(async packageData => {
            const { installationKeyPair, journal } = await import('./store.mjs');
            const { nativeClickOnce } = await import('./pilot-click.mjs');
            const pair = await installationKeyPair(); let invokes = 0; let code = null; let exportCode = null;
            try { await crypto.subtle.exportKey('jwk', pair.privateKey); } catch (error) { exportCode = error.name; }
            try {
                await nativeClickOnce({ ...packageData, releaseKeySha256: 'f'.repeat(64), submissionPermitted: true,
                    attemptId: 900, serverAttemptId: 900, nonce: 'c'.repeat(64), expiresAt: new Date(Date.now() + 10000).toISOString() }, () => { invokes++; });
            } catch (error) { code = error.message; }
            const oldMarker = await journal('get', `native:click:${packageData.projectId}:${packageData.taskId}:${'f'.repeat(64)}:900`);
            return { privateKeyExtractable: pair.privateKey.extractable, exportCode, invokes, code, markerAttemptId: oldMarker?.attemptId };
        }, active);
        assert.equal(rotationProof.privateKeyExtractable, false);
        assert.equal(rotationProof.exportCode, 'InvalidAccessError');
        assert.equal(rotationProof.invokes, 0);
        assert.match(rotationProof.code, /^LOCAL_JOURNAL_(CONFLICT|ABORTED)$/);
        assert.equal(rotationProof.markerAttemptId, 900, 'bundle rotation never clears the old once-only fence');
        await context.close(); context = null;
        await writeFile(path.join(extension, 'README.md'), originalReadme);
        await writeFile(path.join(extension, 'INTEGRITY.json'), originalIntegrity);
        context = await launch();
        const restoredPage = await context.newPage(); await restoredPage.goto(`${base}/pilot.html`);
        const restored = await restoredPage.evaluate(() => chrome.runtime.sendMessage({ operation: 'identity' }));
        assert.equal(restored.bundleSha256, identity.bundleSha256);
        assert.equal(restored.installationId, identity.installationId, 'original bundle key remains durable without overriding rotation');
        assert.equal(observedOrigins.length, networkBeforeMutation);
        const evidence = { schemaVersion: 1, passed: true, container: true, uid: process.getuid(),
            sandbox: sandboxEvidence, fixture: 'synthetic pages and loopback Planner; network none',
            workerOrigin: expectedOrigin, workerOriginVerified: observedOrigins.every(origin => origin === expectedOrigin),
            plannerRequestCount: observedOrigins.length, signedPairingPackages: 2,
            wrongAccountRejected: true, unknownDraftPreserved: true, expiredAndOverlongPermitRejected: true,
            originalEditorNavigations: originalNavigations, originalDocumentPreserved: true,
            controlledProfileTabsClosed: true, finalPresubmitRechecksOriginalEditor: true,
            onceOnlyAfterLostResponseAndRestart: true, prohibitedRequests, providerCalled: false,
            fixtureBundleSha256: fixtureIntegrity.bundleSha256, rotatedFixtureBundleSha256: changedIntegrity.bundleSha256,
            actualFileIntegrityFailsBeforeNetwork: true, buildSpecificNonExportableKeyVerified: true,
            rotatedBuildPreservesPriorFence: true, originalBuildKeyRestored: true,
            sourceBundleSha256: JSON.parse(await readFile(path.join(sourceExtension, 'INTEGRITY.json'), 'utf8')).bundleSha256,
            realAccountUat: false, publicationAuthorized: false };
        assert.equal(evidence.uid, 1000);
        if (process.env.X_BROWSER_EVIDENCE_DIR) {
            await mkdir(process.env.X_BROWSER_EVIDENCE_DIR, { recursive: true });
            await writeFile(path.join(process.env.X_BROWSER_EVIDENCE_DIR, 'x-native-browser.json'), `${JSON.stringify(evidence, null, 2)}\n`);
        }
        console.log(JSON.stringify(evidence));
    } finally {
        try { await context?.close(); } finally {
        server.closeAllConnections();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        await rm(temporary, { recursive: true, force: true });
        }
    }
});
