import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDzen1002StudioPage } from '../services/dzen1002_inventory_browser';

const page = { url: () => 'https://dzen.ru/profile/editor/id/6a8029aba055ec36033bf81c/publications?state=draft' };
test('INV012 Studio URL still requires existing authentication/CAPTCHA guard', async () => {
    let checks = 0;
    await verifyDzen1002StudioPage(page, async () => { checks++; });
    assert.equal(checks, 1);
    await assert.rejects(verifyDzen1002StudioPage(page, async () => { throw new Error('CAPTCHA'); }), /CAPTCHA/);
});
test('INV013 wrong Studio route cannot pass after authentication', async () => {
    await assert.rejects(verifyDzen1002StudioPage({ url: () => 'https://dzen.ru/login' }, async () => {}), /STUDIO_NOT_VERIFIED/);
});
