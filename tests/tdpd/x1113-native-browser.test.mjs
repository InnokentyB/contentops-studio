import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

test('X-NATIVE-03 real isolated Chromium extension persists one non-exportable key across concurrent checks and reload', async () => {
    const extension = fileURLToPath(new URL('../../extensions/x-native', import.meta.url));
    const profile = await mkdtemp(path.join(tmpdir(), 'contentops-x-no-send-'));
    // This fresh profile is never a user profile. No provider origin is loaded.
    const options = {
        channel: 'chromium', headless: true,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    };
    const context = await chromium.launchPersistentContext(profile, options);
    let fingerprint;
    const id = createHash('sha256').update(extension).digest('hex').slice(0, 32)
        .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
    try {
        await context.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
        const page = await context.newPage();
        await page.goto(`chrome-extension://${id}/check.html`);
        const results = await page.evaluate(async () => {
            const { checkPersistence } = await import('./store.mjs');
            return Promise.all([checkPersistence(), checkPersistence()]);
        });
        assert.equal(results[0].fingerprint, results[1].fingerprint);
        fingerprint = results[0].fingerprint;
        for (const result of results) {
            assert.equal(result.persisted, true);
            assert.equal(result.privateKeyExtractable, false);
            assert.equal(result.enrolled, false);
            assert.equal(result.publicationAuthorized, false);
        }
        await page.reload();
        const restored = await page.evaluate(async () => (await import('./store.mjs')).checkPersistence());
        assert.equal(restored.fingerprint, results[0].fingerprint);
    } finally { await context.close(); }
    const reopened = await chromium.launchPersistentContext(profile, options);
    try {
        await reopened.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
        const page = await reopened.newPage();
        await page.goto(`chrome-extension://${id}/check.html`);
        const restored = await page.evaluate(async () => (await import('./store.mjs')).checkPersistence());
        assert.equal(restored.fingerprint, fingerprint);
        assert.equal(restored.privateKeyExtractable, false);
        assert.equal(restored.publicationAuthorized, false);
    } finally { await reopened.close(); }
});
