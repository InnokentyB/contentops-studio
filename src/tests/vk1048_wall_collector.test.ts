import assert from 'node:assert/strict';
import test from 'node:test';
import { collectVk1048Wall, type Vk1048WallSnapshot } from '../services/vk1048_wall_collector';
const row = { objectId: '-240051152_7', publicUrl: 'https://vk.com/wall-240051152_7', text: 'exact full text',
    dates: ['2026-10-13T08:00:00Z'], photoIds: ['photo-240051152_8'], expanded: true };
const now = () => new Date('2026-10-13T09:00:00Z');
function port(snapshot: Vk1048WallSnapshot) { return { snapshot: async () => snapshot, advance: async () => false }; }
test('WALL-001 complete inventory requires observed terminal pagination boundary and exact media bytes', async () => {
    const result = await collectVk1048Wall(port({ rows: [row], terminal: true }), '-240051152', '2026-10-13T07:00:00Z',
        { verify: async () => ({ assetSha256: 'a'.repeat(64), providerMediaId: row.photoIds[0], acknowledged: true }) }, now);
    assert.equal(result.coverage, 'complete_window'); assert.equal(result.rows[0].media?.acknowledged, true);
});
test('WALL-002 stalled scroll and image presence alone cannot prove coverage or asset identity', async () => {
    const result = await collectVk1048Wall(port({ rows: [row], terminal: false }), '-240051152', '2026-10-13T07:00:00Z',
        { verify: async () => null }, now);
    assert.equal(result.coverage, 'partial'); assert.equal(result.rows[0].media, null);
});
test('WALL-003 relative dates, wrong owners and collapsed captions fail closed', async () => {
    for (const invalid of [{ ...row, dates: ['сегодня'] }, { ...row, objectId: '-2_7' }, { ...row, expanded: false }]) {
        const result = await collectVk1048Wall(port({ rows: [invalid], terminal: true }), '-240051152', '2026-10-13T07:00:00Z',
            { verify: async () => null }, now);
        assert.equal(result.coverage, 'partial');
    }
});

test('WALL-004 local DOM extraction expands captions, reads absolute metadata and derives terminal boundary', async (t) => {
    const { chromium } = await import('playwright');
    const { createVk1048WallInventory } = await import('../services/vk1048_wall_collector');
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<article data-testid="post" data-post-id="-240051152_7" data-date="2026-10-13T08:00:00Z">
      <a href="/wall-240051152_7">post</a><a href="/photo-240051152_8">photo</a>
      <div data-testid="post_text">short</div><button data-testid="showmoretext-after" onclick="this.previousElementSibling.textContent='exact full text';this.remove()">more</button>
      </article><div data-testid="wall_feed_end">End</div>`);
    const inventory = createVk1048WallInventory(page);
    const snapshot = await inventory.snapshot();
    assert.equal(snapshot.terminal, true); assert.equal(snapshot.rows[0].text, 'exact full text');
    assert.deepEqual(snapshot.rows[0].photoIds, ['photo-240051152_8']); assert.equal(snapshot.rows[0].expanded, true);
});
