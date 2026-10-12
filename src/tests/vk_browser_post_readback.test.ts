import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { captureVkPostBaseline, readVkPostProof, vkPostProviderDate } from '../services/vk_browser_post_proof';
import { PlaywrightVkBrowserUi } from '../services/vk_browser_playwright_ui';

test('POST-015-01 stale matching wall post cannot confirm a new submission', async () => {
    const html = '<textarea data-testid="posting_base_screen_input_message"></textarea><div data-testid="post" data-post-id="-240051152_30"><div data-testid="post_text">Exact caption</div><a href="https://vk.com/wall-240051152_30"><time datetime="2026-10-06T12:00:00Z">6 October</time></a></div>';
    const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage();
        const ui = new PlaywrightVkBrowserUi(page);
        await ui.navigate(`http://127.0.0.1:${(server.address() as AddressInfo).port}/club240051152`);
        await ui.setPostText('Exact caption');
        assert.equal(await ui.readbackPost(), null);
    } finally {
        await browser.close();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('POST-015 proof rejects stale, foreign, ambiguous and undated DOM candidates', async t => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/*', route => route.abort());
        const row = (id: string, date: string | null, text = 'Exact caption', href = `https://vk.com/wall${id}`) =>
            `<div data-testid="post" data-post-id="${id}"><div data-testid="post_text">${text}</div><a href="${href}">${date ? `<time datetime="${date}">Provider date</time>` : 'today'}</a></div>`;
        const oldDate = '2026-10-12T09:00:00Z';
        const providerDate = '2026-10-12T10:00:02Z';
        await page.setContent(row('-240051152_30', oldDate));
        const baseline = await captureVkPostBaseline(page, '-240051152', new Date('2026-10-12T10:00:00Z'));
        const input = { ownerId: '-240051152', text: 'Exact caption', baseline,
            submissionStartedAt: '2026-10-12T10:00:01Z', observedAt: new Date('2026-10-12T10:00:05Z') };
        await t.test('POST-015-02 unique new same-owner object uses observed provider date', async () => {
            await page.setContent(row('-240051152_30', oldDate) + row('-240051152_31', providerDate));
            const proof = await readVkPostProof(page, input);
            assert.equal(proof?.provider_object_id, '-240051152_31');
            assert.equal(proof?.published_at, '2026-10-12T10:00:02.000Z');
            assert.equal(proof?.provider_timestamp_source, 'provider');
        });
        await t.test('POST-015-03 existing ID remains stale even when DOM date changes', async () => {
            await page.setContent(row('-240051152_30', providerDate));
            assert.equal(await readVkPostProof(page, input), null);
        });
        await t.test('POST-015-04 older object missing from baseline is excluded by date', async () => {
            await page.setContent(row('-240051152_29', oldDate));
            assert.equal(await readVkPostProof(page, input), null);
        });
        await t.test('POST-015-05 foreign owner and hostile permalink cannot confirm', async () => {
            for (const html of [row('-555_31', providerDate), row('-240051152_31', providerDate, 'Exact caption', 'https://evil.example/wall-240051152_31')]) {
                await page.setContent(html);
                assert.equal(await readVkPostProof(page, input), null);
            }
        });
        await t.test('POST-015-06 missing timestamp or two matching new objects stays uncertain', async () => {
            for (const html of [row('-240051152_31', null), row('-240051152_31', providerDate) + row('-240051152_32', providerDate)]) {
                await page.setContent(html);
                assert.equal(await readVkPostProof(page, input), null);
            }
        });
        await t.test('POST-015-07 expired or foreign baseline blocks confirmation', async () => {
            await page.setContent(row('-240051152_31', providerDate));
            assert.equal(await readVkPostProof(page, { ...input, baseline: { ...baseline, owner_id: '-555' } }), null);
            assert.equal(await readVkPostProof(page, { ...input, submissionStartedAt: '2026-10-12T10:10:01Z' }), null);
        });
    } finally { await browser.close(); }
});
test('POST-015-08 absolute provider date parser rejects relative and conflicting metadata', () => {
    assert.equal(vkPostProviderDate(['today']), null);
    assert.equal(vkPostProviderDate(['2026-10-12T10:00:02Z', '2026-10-12T10:00:03Z']), null);
    assert.equal(vkPostProviderDate(['1791799202']), '2026-10-12T10:00:02.000Z');
});
