import { sandboxedChromiumLaunchOptions } from '../services/browser_launch';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PlaywrightVkClipUi, createPlaywrightVkClipPagePort, VkClipProviderEvidence } from '../services/vk_clip_playwright_ui';

const owner = '-240051152', url = 'https://vk.com/clip-240051152_456239099';
const caption = 'Exact approved caption';
const bytes = Buffer.from('synthetic local MP4 fixture, not playable provider media');
const sha = createHash('sha256').update(bytes).digest('hex');
const verified = { permitted: true, domContractVerified: true, evidenceReference: 'fixture-only:synthetic-dom' };
const proof: VkClipProviderEvidence = { public_url: url, provider_object_id: 'clip-240051152_456239099',
    owner_id: owner, provider_kind: 'short_video', provider_timestamp_source: 'provider',
    published_at: '2026-10-12T10:00:00.000Z', observed_at: '2026-10-12T10:01:00.000Z', text: caption,
    media_present: true, clip_media_sha256: sha, media_acknowledgement_reference: 'fixture-only:provider-upload-ack' };

test('Clip driver processes only local DOM fixtures and rejects premature or unverifiable confirmation', async () => {
    const browser = await chromium.launch(sandboxedChromiumLaunchOptions({ headless: true, executablePath: process.env.APP_BROWSER_EXECUTABLE_PATH ?? chromium.executablePath() }));
    const folder = mkdtempSync(join(tmpdir(), 'vk-clip-offline-'));
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.abort());
        const editor = readFileSync(join(__dirname, '../../src/tests/fixtures/vk-clips/editor.html'), 'utf8');
        let published = false, acknowledgement = true;
        const navigations: string[] = [];
        const base = createPlaywrightVkClipPagePort(page);
        let currentUrl = 'about:blank';
        const port = { ...base, snapshot: async () => ({ ...await base.snapshot(), url: currentUrl }), navigate: async (target: string) => {
            navigations.push(target);
            currentUrl = target;
            await page.setContent(target.includes('/clips/upload') ? editor
                : `<article><a href="${url}">Клип</a><a href="https://vk.com/club240051152">Мастерская</a><p>${caption}</p><video></video></article>`);
        } };
        const evidence = { baseline: async () => ({ captured_at: '2026-10-12T09:59:00.000Z', owner_id: owner, object_ids: [], complete: true }),
            publishedClip: async () => published ? { ...proof, media_acknowledgement_reference: acknowledgement ? proof.media_acknowledgement_reference : '' } : null };
        const denied = new PlaywrightVkClipUi(port);
        await assert.rejects(() => denied.openComposer(owner), /VK_CLIP_UI_UNVERIFIED/);
        assert.equal(navigations.length, 0);
        const ui = new PlaywrightVkClipUi(port, verified, evidence);
        await ui.baseline(owner);
        await ui.openComposer(owner);
        assert.equal(navigations[0], 'https://vk.com/clips/upload-240051152');
        const file = join(folder, 'approved.mp4'); writeFileSync(file, bytes);
        await ui.attachMp4(file, sha);
        await ui.setCaption(caption);
        await assert.rejects(() => ui.attachMp4(file, sha), /VK_CLIP_UPLOAD_STATE_INVALID/);
        assert.equal(await page.getByRole('switch', { name: 'Опубликовать в истории' }).getAttribute('aria-checked'), 'false');
        assert.deepEqual(ui.settingsReadback(), { stories: false, comments: true, duets: false, show_in_community: true });
        await assert.rejects(() => ui.readback(), /VK_CLIP_NOT_SUBMITTED/);
        await page.getByRole('switch', { name: 'Разрешить дуэты' }).evaluate(node => node.remove());
        await assert.rejects(() => ui.submit(), /VK_CLIP_EDITOR_SETTINGS_UNVERIFIABLE/);
        assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
        await page.evaluate(() => {
            const toggle = document.createElement('button'); toggle.setAttribute('role', 'switch');
            toggle.setAttribute('aria-label', 'Разрешить дуэты'); toggle.setAttribute('aria-checked', 'false');
            toggle.textContent = 'Разрешить дуэты'; document.body.appendChild(toggle);
        });
        await page.getByRole('switch', { name: 'Разрешить комментарии' }).evaluate(node => node.after(node.cloneNode(true)));
        await assert.rejects(() => ui.submit(), /VK_CLIP_EDITOR_SETTINGS_UNVERIFIABLE/);
        await page.getByRole('switch', { name: 'Разрешить комментарии' }).last().evaluate(node => node.remove());
        await ui.submit();
        assert.equal(await ui.readback(), null, 'a prepublication link alone proves nothing');
        published = true; acknowledgement = false;
        await assert.rejects(() => ui.readback(), /VK_CLIP_MEDIA_BINDING_UNVERIFIABLE/);
        acknowledgement = true;
        const result = await ui.readback();
        assert.equal(result?.published_at, proof.published_at);
        assert.equal(result?.clip_media_sha256, sha);
        assert.equal(result?.provider_kind, 'short_video');
    } finally {
        await browser.close(); rmSync(folder, { recursive: true, force: true });
    }
});

test('missing verification and independent provider collector fail before any navigation', async () => {
    const browser = await chromium.launch(sandboxedChromiumLaunchOptions({ headless: true, executablePath: process.env.APP_BROWSER_EXECUTABLE_PATH ?? chromium.executablePath() }));
    try {
        const page = await browser.newPage(); await page.route('**/*', route => route.abort());
        const port = createPlaywrightVkClipPagePort(page);
        await assert.rejects(() => new PlaywrightVkClipUi(port).assertSurfaceVerified(), /VK_CLIP_UI_UNVERIFIED/);
        await assert.rejects(() => new PlaywrightVkClipUi(port, verified).assertSurfaceVerified(), /VK_CLIP_PROVIDER_EVIDENCE_REQUIRED/);
        assert.equal(page.url(), 'about:blank');
    } finally { await browser.close(); }
});

test('provider relative date, missing media binding and wrong community cannot confirm a fixture Clip', async () => {
    const browser = await chromium.launch(sandboxedChromiumLaunchOptions({ headless: true, executablePath: process.env.APP_BROWSER_EXECUTABLE_PATH ?? chromium.executablePath() }));
    const folder = mkdtempSync(join(tmpdir(), 'vk-clip-invalid-proof-'));
    try {
        const page = await browser.newPage(); await page.route('**/*', route => route.abort());
        const editor = readFileSync(join(__dirname, '../../src/tests/fixtures/vk-clips/editor.html'), 'utf8');
        const base = createPlaywrightVkClipPagePort(page);
        let currentUrl = 'about:blank', observed: VkClipProviderEvidence = { ...proof };
        const port = { ...base, snapshot: async () => ({ ...await base.snapshot(), url: currentUrl }), navigate: async (target: string) => {
            currentUrl = target;
            await page.setContent(target.includes('/clips/upload') ? editor
                : `<a href="https://vk.com/club240051152">Мастерская</a><p>${caption}</p><video></video>`);
        } };
        const reader = { baseline: async () => ({ captured_at: '2026-10-12T09:59:00.000Z', owner_id: owner, object_ids: [], complete: true }),
            publishedClip: async () => observed };
        const ui = new PlaywrightVkClipUi(port, verified, reader);
        await ui.baseline(owner); await ui.openComposer(owner);
        const file = join(folder, 'approved.mp4'); writeFileSync(file, bytes);
        await assert.rejects(() => ui.attachMp4(file, 'f'.repeat(64)), /VK_CLIP_LOCAL_MEDIA_HASH_MISMATCH/);
        assert.equal(await page.locator('input[type=file]').evaluate((input: HTMLInputElement) => input.files?.length), 0);
        await ui.attachMp4(file, sha); await ui.setCaption(caption); await ui.submit();
        observed = { ...proof, published_at: '6 минут назад' };
        await assert.rejects(() => ui.readback(), /VK_CLIP_PROVIDER_EVIDENCE_INVALID/);
        observed = { ...proof, owner_id: '-999' };
        await assert.rejects(() => ui.readback(), /VK_CLIP_PUBLICATION_IDENTITY_MISMATCH/);
        observed = { ...proof, media_acknowledgement_reference: '' };
        await assert.rejects(() => ui.readback(), /VK_CLIP_MEDIA_BINDING_UNVERIFIABLE/);
        observed = { ...proof, media_acknowledgement_reference: 'https://example.invalid/upload?access_token=synthetic' };
        await assert.rejects(() => ui.readback(), /VK_CLIP_PROVIDER_EVIDENCE_INVALID/);
        await assert.rejects(() => ui.submit(), /VK_CLIP_SUBMIT_STATE_INVALID/);
    } finally { await browser.close(); rmSync(folder, { recursive: true, force: true }); }
});
