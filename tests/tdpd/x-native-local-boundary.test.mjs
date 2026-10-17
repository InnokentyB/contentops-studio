import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { journal } from '../../extensions/x-native/store.mjs';
import vm from 'node:vm';

test('numeric journal IDs reach the durable store; malformed keys fail before storage', async () => {
    const previous = globalThis.indexedDB;
    let opens = 0;
    globalThis.indexedDB = { open() { opens++; throw Error('SYNTHETIC_STORE_REACHED'); } };
    try {
        for (const key of [`native:index:301:401`, `native:flight:301:401:${'a'.repeat(64)}`,
            `native:release-click:301:401:${'b'.repeat(64)}`, `native:click:301:401:${'c'.repeat(64)}:900`]) {
            await assert.rejects(journal('get', key), /SYNTHETIC_STORE_REACHED/);
        }
        assert.equal(opens, 4);
        for (const key of ['native:index:0:401', 'native:index:3\\d:4\\d', 'native:index:301:401:extra']) {
            await assert.rejects(journal('get', key), /LOCAL_JOURNAL_INVALID/);
        }
        assert.equal(opens, 4);
    } finally { globalThis.indexedDB = previous; }
});

test('executor receipt HTTP payload never forwards context or raw lease', async () => {
    const source = await readFile('extensions/x-native/pilot-background.mjs', 'utf8');
    const receipts = [...source.matchAll(/request\('receipt',\s*\{([^\n]+)\}/g)];
    assert.equal(receipts.length, 4);
    for (const receipt of receipts) {
        assert.match(receipt[1], /^\s*receipt:/);
        assert.doesNotMatch(receipt[1], /context|lease/);
    }
});

test('native package rejects type-coerced hashes before touching the page', async () => {
    let handler;
    vm.runInNewContext(await readFile('extensions/x-native/pilot-native.js', 'utf8'), {
        chrome: { runtime: { id: 'synthetic', onMessage: { addListener(fn) { handler = fn; } } } },
    });
    const result = await new Promise(resolve => handler({ operation: 'editor', text: 'Synthetic', packageData: {
        projectId: 301, taskId: 401, channelId: 501, revision: 2, bodySha256: ['a'.repeat(64)],
        account: '@fixture_301', profileUrl: 'https://x.com/fixture_301', scheduleAt: '2026-10-17T10:00:00Z',
    } }, { id: 'synthetic' }, resolve));
    assert.equal(result.code, 'NATIVE_PACKAGE_INVALID');
});

test('a future-scheduled native click is rejected before any page interaction', async () => {
    let handler; let pageReads = 0;
    const surface = { chrome: { runtime: { id: 'synthetic', onMessage: { addListener(fn) { handler = fn; } } } } };
    Object.defineProperty(surface, 'location', { get() { pageReads++; throw Error('SYNTHETIC_PAGE_ACCESSED'); } });
    vm.runInNewContext(await readFile('extensions/x-native/pilot-native.js', 'utf8'), surface);
    const result = await new Promise(resolve => handler({ operation: 'click', text: 'Synthetic', packageData: {
        projectId: 301, taskId: 401, channelId: 501, revision: 2, bodySha256: 'a'.repeat(64),
        account: '@fixture_301', profileUrl: 'https://x.com/fixture_301', scheduleAt: new Date(Date.now() + 60000).toISOString(),
    }, permit: { attemptId: 901, expiresAt: new Date(Date.now() + 10000).toISOString() } }, { id: 'synthetic' }, resolve));
    assert.equal(result.code, 'NATIVE_NOT_DUE'); assert.equal(pageReads, 0);
});

test('popup errors explain recovery and unchanged live status is not rewritten on timer ticks', async () => {
    const elements = new Map(); const timers = [];
    const state = { busy: false, canRun: false, canConsent: false, consent: false, result: { status: 'NOT_CHECKED' } };
    const el = id => {
        if (!elements.has(id)) elements.set(id, { writes: 0, value: '', addEventListener() {}, removeAttribute() {},
            set textContent(value) { this.value = value; this.writes++; }, get textContent() { return this.value; } });
        return elements.get(id);
    };
    const source = (await readFile('extensions/x-native/pilot-ui.mjs', 'utf8')).replace(/^import[^\n]+\n/, '');
    vm.runInNewContext(source, { document: { getElementById: el }, setInterval(fn) { timers.push(fn); },
        createController: () => ({ view: () => state }), chrome: { runtime: {} } });
    timers[0](); timers[0](); assert.equal(el('result').writes, 1);
    state.result = { status: 'LOCAL_PACKAGE_INVALID' }; timers[0]();
    assert.match(el('result').textContent, /JSON/); assert.match(el('result').textContent, /Planner/);
    assert.equal(el('result').writes, 2);
});
